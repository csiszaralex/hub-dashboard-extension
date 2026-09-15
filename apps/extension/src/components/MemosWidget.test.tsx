import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const payload = {
  memos: [
    { name: 'memos/1', creator: 'users/1', content: 'one #todo', snippet: 'one', tags: ['todo'] },
    { name: 'memos/2', creator: 'users/1', content: 'two #todo', snippet: 'two', tags: ['todo'] },
    { name: 'memos/3', creator: 'users/1', content: 'three #todo', snippet: 'three', tags: ['todo'] },
    { name: 'memos/4', creator: 'users/1', content: 'four #todo', snippet: 'four', tags: ['todo'] },
  ],
};

/** Connected as `users/1`: what a successful Connect leaves behind on this machine. */
const seedConfigured = () => {
  const stub = installChromeStub();
  stub.seedSync({ memosUrl: 'https://memo.example.com', memosTag: 'todo' });
  stub.seedLocal({ memos_token: 'memos_pat_x', memos_user: 'users/1' });
  stub.grantOrigins(['https://memo.example.com/*']);
  return stub;
};

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

/** A fetch that never reaches the server at all — what `listMemos` reports as `network`. */
const rejectingFetch = () => vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

/**
 * `src/test/setup.ts` calls `vi.resetModules()` before every test, so i18n has
 * to be initialised inside the test — otherwise `t()` returns raw keys and
 * every assertion below looks for text that was never rendered. This is the
 * same `load` shape `QuoteWidget.test.tsx` uses.
 */
const load = async () => {
  await import('../i18n/i18n');
  return (await import('./MemosWidget')).MemosWidget;
};

describe('MemosWidget', () => {
  it('shows three rows and a count of the rest', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, payload));
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.queryByText('four')).toBeNull();
    expect(screen.getByText('+1 more')).toBeTruthy();
  });

  // The whole reason for a compact view: ticking the top item off must not
  // cost an expand first.
  it('archives straight from a compact row', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, payload));
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    vi.stubGlobal('fetch', respondWith(200, {}));
    fireEvent.click(screen.getAllByTitle('Mark done')[0]);

    await waitFor(() => expect(screen.queryByText('one')).toBeNull());
  });

  it('expands into the panel and shows the composer', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, payload));
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    fireEvent.click(screen.getByText('+1 more'));

    expect(screen.getByPlaceholderText('New memo…')).toBeTruthy();
    expect(screen.getByText('four')).toBeTruthy();
  });

  it('points the user at settings when nothing is configured', async () => {
    installChromeStub();
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() =>
      expect(screen.getByText('Connect your Memos server in settings')).toBeTruthy(),
    );
  });

  // Nothing is cached yet — the very first visit to a configured-but-unreachable
  // server — so "Showing cached memos" would be a lie, and it must not stand
  // next to "Nothing here" either: only one of the two is ever true at once.
  it('shows only the unreachable message when the cache is empty and the fetch fails', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', rejectingFetch());
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() => expect(screen.getByText("Can't reach your Memos server")).toBeTruthy());
    expect(screen.queryByText('Nothing here')).toBeNull();
    expect(screen.queryByText('Showing cached memos')).toBeNull();
  });

  it('keeps the cached rows and reports the failure alongside them', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: { memos: payload.memos.slice(0, 2) } });
    vi.stubGlobal('fetch', rejectingFetch());
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
    expect(screen.getByText('Showing cached memos')).toBeTruthy();
  });

  it('still reports the failure once the panel holding the composer is open', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: { memos: payload.memos.slice(0, 2) } });
    vi.stubGlobal('fetch', rejectingFetch());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('Showing cached memos')).toBeTruthy());

    fireEvent.click(screen.getByText('Memos'));

    expect(screen.getByPlaceholderText('New memo…')).toBeTruthy();
    expect(screen.getByText('Showing cached memos')).toBeTruthy();
  });
});
