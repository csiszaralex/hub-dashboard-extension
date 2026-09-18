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
  // The server goes first, and the URL last. An open tab reloads on each of
  // these local writes, and it refuses to ask anything while the stored server
  // and its own `memosUrl` disagree — so writing the token first would leave a
  // window where that tab pairs a new token with the old server and sends the
  // credential to the host the user is leaving.
  it('writes the server, then the credentials, then the url an open tab reacts to', async () => {
    const stub = installChromeStub();
    vi.stubGlobal('fetch', connectable());

    const writes: string[] = [];
    let storedWhenUrlLanded: unknown[] = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      for (const key of Object.keys(changes)) writes.push(`${area}:${key}`);
      if ('memosUrl' in changes) {
        storedWhenUrlLanded = [
          stub.readLocal('memos_server'),
          stub.readLocal('memos_token'),
          stub.readLocal('memos_user'),
        ];
      }
    });

    await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(writes).toContain('sync:memosUrl'));
    expect(writes).toEqual([
      'local:memos_server',
      'local:memos_token',
      'local:memos_user',
      'sync:memosUrl',
    ]);
    expect(storedWhenUrlLanded).toEqual([
      'https://memo.example.com',
      'memos_pat_x',
      'users/1',
    ]);
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

describe('MemosSection — a Connect that fails', () => {
  const held = (origin: string) =>
    new Promise((resolve) => chrome.permissions.contains({ origins: [`${origin}/*`] }, resolve));

  // The grant is asked for before the server can be probed, because the click's
  // gesture does not survive an await. A failure after that would otherwise
  // leave the extension holding access to a host it never managed to use — and
  // on a fresh install there is no Disconnect button yet to hand it back.
  it('hands back a grant it had just asked for', async () => {
    installChromeStub();
    vi.stubGlobal('fetch', connectable());

    await renderSection('');
    typeUrl('https://memo.example.com');
    typeToken('memos_pat_wrong');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('The server rejected that token')).toBeTruthy());
    await expect(held('https://memo.example.com')).resolves.toBe(false);
  });

  // One it already had is not its to take away: the user is reconnecting to the
  // server they are already using, and a mistyped token is no reason to make
  // them grant access to it again.
  it('keeps a grant it already had when the same server refuses the token', async () => {
    const stub = installChromeStub();
    stub.grantOrigins(['https://memo.example.com/*']);
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://memo.example.com');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    typeToken('memos_pat_wrong');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('The server rejected that token')).toBeTruthy());
    await expect(held('https://memo.example.com')).resolves.toBe(true);
  });
});

describe('MemosSection — disconnecting', () => {
  const seedConnected = (baseUrl = 'https://memo.example.com') => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: baseUrl });
    stub.seedLocal({
      memos_server: baseUrl,
      memos_token: 'memos_pat_x',
      memos_user: 'users/1',
      memos_cache: { baseUrl, memos: [] },
      memos_check: { baseUrl, nextAt: Date.now() + 60_000, failure: null },
      memos_draft: 'half a thought',
    });
    stub.grantOrigins([`${baseUrl}/*`]);
    return stub;
  };

  // Until now the only way to remove the token was to uninstall the extension.
  it('removes everything this machine stored, and the server URL', async () => {
    const stub = seedConnected();

    const { onUrlChange } = await renderSection('https://memo.example.com');
    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => expect(stub.readLocal('memos_token')).toBeUndefined());
    for (const key of ['memos_server', 'memos_user', 'memos_cache', 'memos_check', 'memos_draft']) {
      expect(stub.readLocal(key)).toBeUndefined();
    }
    expect(stub.readSync('memosUrl')).toBe('');
    expect(onUrlChange).toHaveBeenCalledWith('');
  });

  // Keeping access to a server the user has left is exactly what the optional,
  // one-origin permission model exists to avoid.
  it('hands the host permission back', async () => {
    seedConnected();

    await renderSection('https://memo.example.com');
    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() =>
      expect(
        new Promise((resolve) =>
          chrome.permissions.contains({ origins: ['https://memo.example.com/*'] }, resolve),
        ),
      ).resolves.toBe(false),
    );
  });

  it('clears the fields so the tab no longer shows a server', async () => {
    seedConnected();

    await renderSection('https://memo.example.com');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => expect(screen.getByText('Disconnected')).toBeTruthy());
    expect((screen.getByLabelText('Server URL') as HTMLInputElement).value).toBe('');
    expect(tokenField().value).toBe('');
  });

  // Nothing to disconnect from, nothing to offer.
  it('offers no Disconnect until a server is set', async () => {
    installChromeStub();
    await renderSection('');
    expect(screen.queryByText('Disconnect')).toBeNull();
  });

  // Disconnecting is all local writes and a permission release, so it works
  // with the server unreachable — which is often exactly when someone wants it.
  it('works with no network at all', async () => {
    const stub = seedConnected();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await renderSection('https://memo.example.com');
    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => expect(stub.readLocal('memos_token')).toBeUndefined());
  });
});

describe('MemosSection — moving to another server', () => {
  const seedConnected = (baseUrl: string) => {
    const stub = installChromeStub();
    stub.seedLocal({
      memos_server: baseUrl,
      memos_token: 'memos_pat_old',
      memos_user: 'users/1',
      memos_cache: { baseUrl, memos: [] },
      memos_check: { baseUrl, nextAt: Date.now() + 60_000, failure: null },
      memos_draft: 'half a thought',
    });
    stub.grantOrigins([`${baseUrl}/*`]);
    return stub;
  };

  const connectTo = async (url: string, token: string) => {
    typeUrl(url);
    typeToken(token);
    fireEvent.click(screen.getByText('Connect'));
  };

  // The old server's memos are not the new one's, and its check would hold the
  // new one back for minutes.
  it('drops the old cache and check once the new server answers', async () => {
    const stub = seedConnected('https://old.example.com');
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://old.example.com');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await connectTo('https://memo.example.com', 'memos_pat_x');

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    expect(stub.readLocal('memos_cache')).toBeUndefined();
    expect(stub.readLocal('memos_check')).toBeUndefined();
  });

  // The draft is text the user typed, not the server's data.
  it('keeps the unsent draft', async () => {
    const stub = seedConnected('https://old.example.com');
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://old.example.com');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await connectTo('https://memo.example.com', 'memos_pat_x');

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    expect(stub.readLocal('memos_draft')).toBe('half a thought');
  });

  it('hands the old origin back', async () => {
    seedConnected('https://old.example.com');
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://old.example.com');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await connectTo('https://memo.example.com', 'memos_pat_x');

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    await expect(
      new Promise((resolve) =>
        chrome.permissions.contains({ origins: ['https://old.example.com/*'] }, resolve),
      ),
    ).resolves.toBe(false);
  });

  // A Connect that fails must not take the working setup down with it — which
  // is what an offline attempt at a new server would otherwise do.
  it('leaves the old server alone when the new one cannot be reached', async () => {
    const stub = seedConnected('https://old.example.com');
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await renderSection('https://old.example.com');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await connectTo('https://memo.example.com', 'memos_pat_new');

    await waitFor(() => expect(screen.getByText('Could not reach that server')).toBeTruthy());
    expect(stub.readLocal('memos_cache')).toBeDefined();
    expect(stub.readLocal('memos_check')).toBeDefined();
    expect(stub.readLocal('memos_token')).toBe('memos_pat_old');
    await expect(
      new Promise((resolve) =>
        chrome.permissions.contains({ origins: ['https://old.example.com/*'] }, resolve),
      ),
    ).resolves.toBe(true);
  });

  // Same server, new token: the list and the check still describe it.
  it('keeps the cache when reconnecting to the same server', async () => {
    const stub = seedConnected('https://memo.example.com');
    vi.stubGlobal('fetch', connectable());

    await renderSection('https://memo.example.com');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    expect(stub.readLocal('memos_cache')).toBeDefined();
  });
});
