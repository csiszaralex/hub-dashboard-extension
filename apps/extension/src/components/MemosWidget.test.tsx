import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const payload = {
  memos: [
    { name: 'memos/1', content: 'one #todo', snippet: 'one', tags: ['todo'] },
    { name: 'memos/2', content: 'two #todo', snippet: 'two', tags: ['todo'] },
    { name: 'memos/3', content: 'three #todo', snippet: 'three', tags: ['todo'] },
    { name: 'memos/4', content: 'four #todo', snippet: 'four', tags: ['todo'] },
  ],
};

const seedConfigured = () => {
  const stub = installChromeStub();
  stub.seedSync({ memosUrl: 'https://memo.example.com', memosTag: 'todo' });
  stub.seedLocal({ memos_token: 'memos_pat_x' });
  stub.grantOrigins(['https://memo.example.com/*']);
  return stub;
};

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

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
});
