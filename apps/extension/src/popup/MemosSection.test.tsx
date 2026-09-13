import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

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

describe('MemosSection', () => {
  it('refuses a non-https url without asking Chrome for anything', async () => {
    installChromeStub();
    const fetchMock = respondWith(200, {});
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
    vi.stubGlobal('fetch', respondWith(200, { version: '0.30.0' }));

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
  // Confirmed empirically — see the fix-round-2 report for both runs.
  it('ignores a second click that lands before React can disable the button', async () => {
    installChromeStub();
    let resolvePrompt: ((granted: boolean) => void) | undefined;
    const requestSpy = vi
      .spyOn(chrome.permissions, 'request')
      .mockImplementation((_permissions, callback) => {
        resolvePrompt = callback;
      });
    vi.stubGlobal('fetch', respondWith(200, { version: '0.30.0' }));

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
    vi.stubGlobal('fetch', respondWith(200, { version: '0.30.0' }));

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    expect(onUrlChange).toHaveBeenCalledWith('https://memo.example.com');
    expect(stub.readLocal('memos_token')).toBe('memos_pat_x');
    // Connect persists the URL itself. Leaving it to the form's Save would let
    // someone connect, close the popup, and keep a token with no server.
    await waitFor(() => expect(stub.readSync('memosUrl')).toBe('https://memo.example.com'));
  });

  // A refused prompt must not leave a half-configured widget behind.
  it('saves nothing when the user refuses the permission prompt', async () => {
    const stub = installChromeStub();
    stub.denyPermissionRequests();
    const fetchMock = respondWith(200, { version: '0.30.0' });
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
    expect(stub.readSync('memosUrl')).toBeUndefined();
  });

  it('reports an old server as a version problem and saves nothing', async () => {
    const stub = installChromeStub();
    vi.stubGlobal('fetch', respondWith(404, {}));

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Memos 0.30.0 or newer is required')).toBeTruthy());
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(stub.readLocal('memos_token')).toBeUndefined();
    expect(stub.readSync('memosUrl')).toBeUndefined();
  });
});
