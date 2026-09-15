import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { memosConnectRoutes, routeFetch } from '../test/memosFetch';

/** A v0.30 server that issued `memos_pat_x` to `users/1`, and no other token. */
const connectable = () => routeFetch(memosConnectRoutes({ tokens: { memos_pat_x: 'users/1' } }));

/** i18n inside the test, for the reason `MemosWidget.test.tsx` spells out. */
const renderSection = async (url = '') => {
  await import('../i18n/i18n');
  const { MemosSection } = await import('./MemosSection');
  const onUrlChange = vi.fn();
  render(<MemosSection url={url} tag='' onUrlChange={onUrlChange} onTagChange={vi.fn()} />);
  return { onUrlChange };
};

const typeToken = (value: string) =>
  fireEvent.change(screen.getByLabelText('Access token'), { target: { value } });

const typeUrl = (value: string) =>
  fireEvent.change(screen.getByLabelText('Server URL'), { target: { value } });

const tokenField = () => screen.getByLabelText('Access token') as HTMLInputElement;

describe('MemosSection', () => {
  it('refuses a non-https url without asking Chrome for anything', async () => {
    installChromeStub();
    const fetchMock = connectable();
    vi.stubGlobal('fetch', fetchMock);
    // The claim in this test's name is "without asking Chrome for anything" —
    // only `fetchMock`/`onUrlChange` proved that before; this spy is what
    // actually observes that `chrome.permissions.request` was never reached.
    const requestSpy = vi.spyOn(chrome.permissions, 'request');

    const { onUrlChange } = await renderSection('http://memo.example.com');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('That is not an https URL')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('ignores a second Connect click while the permission prompt is still open', async () => {
    installChromeStub();
    // A real permission prompt is a native dialog the user must dismiss, so it
    // does not resolve on its own — captured here so the test controls exactly
    // when it does.
    let resolvePrompt: ((granted: boolean) => void) | undefined;
    const requestSpy = vi
      .spyOn(chrome.permissions, 'request')
      .mockImplementation((_permissions, callback) => {
        resolvePrompt = callback;
      });
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');

    const button = screen.getByText('Connect') as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);

    // Only one request reached Chrome, and the button disabling itself is what
    // stops a third click from mattering either.
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    resolvePrompt?.(true);

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
  });

  // `fireEvent.click` wraps each dispatch in its own `act()`, so by the time a
  // second `fireEvent.click` runs, React has already committed the first
  // click's `disabled={true}` to the DOM — happy-dom's disabled-button
  // dispatch short-circuits before any listener runs, so that alone would
  // make the test above pass even without `connectingRef`. Firing both clicks
  // inside one `act()` batch is what actually exercises the ref: React cannot
  // commit `disabled` between them, so only the synchronous ref stops the
  // second click from reaching `connect()` and issuing a second request.
  // Confirmed empirically: with the ref guard removed, the two `click()` calls
  // inside one `act()` both reach `connect()` before React commits `disabled`,
  // and Chrome is asked twice — this test fails while the one above still
  // passes. Only the ref stops the second.
  it('ignores a second click that lands before React can disable the button', async () => {
    installChromeStub();
    let resolvePrompt: ((granted: boolean) => void) | undefined;
    const requestSpy = vi
      .spyOn(chrome.permissions, 'request')
      .mockImplementation((_permissions, callback) => {
        resolvePrompt = callback;
      });
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');

    const button = screen.getByText('Connect') as HTMLButtonElement;
    act(() => {
      button.click();
      button.click();
    });

    expect(requestSpy).toHaveBeenCalledTimes(1);

    resolvePrompt?.(true);
    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
  });

  it('saves the url only after the permission and the probe both succeed', async () => {
    const stub = installChromeStub();
    vi.stubGlobal('fetch', connectable());

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    expect(onUrlChange).toHaveBeenCalledWith('https://memo.example.com');
    expect(stub.readLocal('memos_token')).toBe('memos_pat_x');
    expect(stub.readLocal('memos_user')).toBe('users/1');
    // Connect persists the URL itself. Leaving it to the form's Save would let
    // someone connect, close the popup, and keep a token with no server.
    await waitFor(() => expect(stub.readSync('memosUrl')).toBe('https://memo.example.com'));
  });

  // A refused prompt must not leave a half-configured widget behind.
  it('saves nothing when the user refuses the permission prompt', async () => {
    const stub = installChromeStub();
    stub.denyPermissionRequests();
    const fetchMock = connectable();
    vi.stubGlobal('fetch', fetchMock);

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() =>
      expect(screen.getByText('Chrome was not given access to that server')).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(stub.readLocal('memos_token')).toBeUndefined();
    expect(stub.readLocal('memos_user')).toBeUndefined();
    expect(stub.readSync('memosUrl')).toBeUndefined();
  });

  it('reports an old server as a version problem and saves nothing', async () => {
    const stub = installChromeStub();
    // A pre-0.30 server has none of the v0.30 routes, so every one of them 404s.
    vi.stubGlobal('fetch', routeFetch({}));

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Memos 0.30.0 or newer is required')).toBeTruthy());
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(stub.readLocal('memos_token')).toBeUndefined();
    expect(stub.readLocal('memos_user')).toBeUndefined();
    expect(stub.readSync('memosUrl')).toBeUndefined();
  });

  // The instance profile is public and answers 200 for any token, so a server
  // that is up and new enough proves nothing about the token. Only the
  // current-user endpoint refuses one it did not issue.
  it('rejects a token the server did not issue and saves nothing', async () => {
    const stub = installChromeStub();
    vi.stubGlobal('fetch', routeFetch(memosConnectRoutes({ tokens: { memos_pat_real: 'users/1' } })));

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_typo');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('The server rejected that token')).toBeTruthy());
    expect(screen.queryByText(/Connected to Memos/)).toBeNull();
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(stub.readLocal('memos_token')).toBeUndefined();
    expect(stub.readLocal('memos_user')).toBeUndefined();
    expect(stub.readSync('memosUrl')).toBeUndefined();
  });

  // An already-open new tab re-runs on the `memosUrl` change and reads the
  // token and the account straight out of local storage. If the URL landed
  // first, that tab would find a server with no credentials and settle on
  // "reconnect" until it was reloaded.
  it('writes the token and the account before the url an open tab reacts to', async () => {
    const stub = installChromeStub();
    vi.stubGlobal('fetch', connectable());

    const writes: string[] = [];
    let credentialsWhenUrlLanded: unknown[] = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      for (const key of Object.keys(changes)) writes.push(`${area}:${key}`);
      if ('memosUrl' in changes) {
        credentialsWhenUrlLanded = [stub.readLocal('memos_token'), stub.readLocal('memos_user')];
      }
    });

    await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(writes).toContain('sync:memosUrl'));
    expect(writes).toEqual(['local:memos_token', 'local:memos_user', 'sync:memosUrl']);
    expect(credentialsWhenUrlLanded).toEqual(['memos_pat_x', 'users/1']);
  });

  // The token field is pre-filled from storage, and a token is a credential for
  // one server. Pointing the form at another server must not carry it along,
  // or Connect hands the old server's secret to a host the user just typed.
  it('does not send the stored token to a server at a different origin', async () => {
    const stub = installChromeStub();
    stub.seedLocal({ memos_token: 'memos_pat_old' });
    // b is a real v0.30 server, but it never issued `memos_pat_old`.
    const fetchMock = routeFetch(memosConnectRoutes({ tokens: { memos_pat_b: 'users/7' } }));
    vi.stubGlobal('fetch', fetchMock);

    await renderSection('https://a.example.com');
    await waitFor(() => expect(tokenField().value).toBe('memos_pat_old'));

    // Another address on the same origin is still the server the token is for.
    typeUrl('https://a.example.com/memos');
    expect(tokenField().value).toBe('memos_pat_old');

    typeUrl('https://b.example.com');
    expect(tokenField().value).toBe('');

    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(screen.getByText('The server rejected that token')).toBeTruthy());

    const toB = fetchMock.mock.calls.filter(([url]) => url.startsWith('https://b.example.com/'));
    expect(toB.length).toBeGreaterThan(0);
    for (const [, init] of toB) {
      expect(new Headers(init?.headers).get('Authorization')).not.toBe('Bearer memos_pat_old');
    }
  });

  // Once Connect has saved a token, it is the stored token for that server —
  // the same reasoning as above applies to the next server typed.
  it('does not carry a token Connect just saved to a server at a different origin', async () => {
    installChromeStub();
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://memo.example.com');
    // Let the mount-time read of the (empty) stored token land first, or it
    // blanks the field after the typing below and the last assertion would
    // pass for that reason alone.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    expect(tokenField().value).toBe('memos_pat_x');

    typeUrl('https://other.example.com');
    expect(tokenField().value).toBe('');
  });
});
