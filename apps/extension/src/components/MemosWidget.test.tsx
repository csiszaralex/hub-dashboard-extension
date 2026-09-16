import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { memosConnectRoutes, memosListRoute, routeFetch, UNAUTHENTICATED } from '../test/memosFetch';

const BASE = 'https://memo.example.com';
const TOKENS = { memos_pat_x: 'users/1' };

/**
 * Snippets carry their tags, the way the server writes them: `GenerateSnippet`
 * renders a tag node back as `#` plus the tag. The widget is what takes them
 * out again.
 */
const payload = [
  { name: 'memos/1', creator: 'users/1', content: 'one #todo', snippet: 'one #todo', tags: ['todo'] },
  {
    name: 'memos/2',
    creator: 'users/1',
    content: 'two #todo #proj',
    snippet: 'two #todo #proj',
    tags: ['todo', 'proj'],
  },
  {
    name: 'memos/3',
    creator: 'users/1',
    content: 'three #todo',
    snippet: 'three #todo',
    tags: ['todo'],
  },
  { name: 'memos/4', creator: 'users/1', content: 'four #todo', snippet: 'four #todo', tags: ['todo'] },
];

const cacheOf = (memos: Record<string, unknown>[]) => ({ baseUrl: BASE, memos });

/** Says the server was asked a moment ago, so a load uses the cache instead. */
const freshCheck = () => ({ baseUrl: BASE, nextAt: Date.now() + 60_000, failure: null });

/** Connected as `users/1`: what a successful Connect leaves behind on this machine. */
const seedConfigured = (memosTag = 'todo') => {
  const stub = installChromeStub();
  stub.seedSync({ memosUrl: BASE, memosTag });
  stub.seedLocal({ memos_server: BASE, memos_token: 'memos_pat_x', memos_user: 'users/1' });
  stub.grantOrigins([`${BASE}/*`]);
  return stub;
};

/** A v0.30 server holding `memos`, which accepts only this machine's token. */
const serve = (memos: Record<string, unknown>[] = payload) =>
  routeFetch({ ...memosConnectRoutes({ tokens: TOKENS }), ...memosListRoute({ tokens: TOKENS, memos }) });

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

/** A fetch that never reaches the server at all — what the client reports as `network`. */
const rejectingFetch = () => vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

/**
 * Lets the settings read and the hook's load run to completion. For a widget
 * that should render nothing there is no element to wait for, so this waits
 * for the queue to drain instead.
 */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const composeAndSubmit = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText('New memo…'), { target: { value: text } });
  fireEvent.click(screen.getByText('Add'));
};

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
    vi.stubGlobal('fetch', serve());
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
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    vi.stubGlobal('fetch', respondWith(200, {}));
    fireEvent.click(screen.getAllByTitle('Mark done')[0]);

    await waitFor(() => expect(screen.queryByText('one')).toBeNull());
  });

  it('expands into the panel and shows the composer', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    fireEvent.click(screen.getByText('+1 more'));

    expect(screen.getByPlaceholderText('New memo…')).toBeTruthy();
    expect(screen.getByText('four')).toBeTruthy();
  });
});

describe('MemosWidget — tags', () => {
  // The tag is written into the memo's text, and composeContent appends one to
  // everything the widget itself sends. Left in, every row would repeat the
  // filter it is already under.
  it('takes the tags out of the text and shows them as chips', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('two')).toBeTruthy());

    expect(screen.getByText('proj')).toBeTruthy();
    expect(screen.queryByText('#proj')).toBeNull();
    expect(screen.queryByText('two #todo #proj')).toBeNull();
  });

  it('leaves the filtered tag off the rows that all carry it', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    expect(screen.queryByText('todo')).toBeNull();
  });

  // Nothing but a tag is a perfectly ordinary memo; it should still be a row.
  it('shows the chip alone when the memo was nothing but a tag', async () => {
    seedConfigured('');
    vi.stubGlobal(
      'fetch',
      serve([{ name: 'memos/1', creator: 'users/1', content: '#todo', snippet: '#todo', tags: ['todo'] }]),
    );
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() => expect(screen.getByText('todo')).toBeTruthy());
    expect(screen.queryByText('#todo')).toBeNull();
  });

  it('filters to a tag clicked on a row in the panel', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
    fireEvent.click(screen.getByText('+1 more'));

    const row = screen.getByText('two').closest('div') as HTMLElement;
    fireEvent.click(within(row).getByText('proj'));

    await waitFor(() => expect(screen.queryByText('one')).toBeNull());
    expect(screen.getByText('two')).toBeTruthy();
  });

  // In the compact view a click on the row opens the panel; a chip that also
  // filtered would change what is shown with no filter row to say so.
  it('shows compact chips as labels rather than buttons', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('two')).toBeTruthy());

    expect(screen.getByText('proj').tagName).toBe('SPAN');
  });
});

describe('MemosWidget — setup states', () => {
  // Every user who never set the widget up — which is nearly all of them — has
  // no server. They must not get a Memos prompt on every new tab; the widget is
  // off until it is configured.
  it('renders nothing at all when no server is set', async () => {
    installChromeStub();
    const MemosWidget = await load();

    const { container } = render(<MemosWidget />);
    await settle();

    expect(screen.queryByText('Reconnect your Memos server in settings')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  // Chrome drops the host grant every time an unpacked build is reloaded, and
  // the connection is otherwise intact. Sending the user to the popup to press
  // Connect again would be busywork: a click on this page is the very gesture
  // `permissions.request` needs.
  it('offers one click to get host access back, without opening the popup', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({ memos_server: BASE, memos_token: 'memos_pat_x', memos_user: 'users/1' });
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('Reconnect')).toBeTruthy());

    fireEvent.click(screen.getByText('Reconnect'));

    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
  });

  // A server is set, so the user did configure it — but this machine has no
  // token for it (the URL syncs, the token does not), so there is something
  // to act on.
  it('prompts a reconnect when a server is set but this machine has no token for it', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({ memos_server: BASE, memos_user: 'users/1' });
    stub.grantOrigins([`${BASE}/*`]);
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() =>
      expect(screen.getByText('Reconnect your Memos server in settings')).toBeTruthy(),
    );
  });
});

describe('MemosWidget — failures', () => {
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
    stub.seedLocal({ memos_cache: cacheOf(payload.slice(0, 2)) });
    vi.stubGlobal('fetch', rejectingFetch());
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
    expect(screen.getByText('Showing cached memos')).toBeTruthy();
  });

  // An expired token is the one failure that looks like success: the list
  // endpoint still answers, with public memos only. The user is told, and the
  // rows they had stay on screen.
  it('reports a token the server no longer accepts, keeping the cached rows', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(payload.slice(0, 2)) });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        ...memosConnectRoutes({ tokens: { memos_pat_renewed: 'users/1' } }),
        ...memosListRoute({ tokens: { memos_pat_renewed: 'users/1' }, memos: [] }),
      }),
    );
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() =>
      expect(
        screen.getByText('Your Memos token is invalid or has expired — reconnect in settings'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('one')).toBeTruthy();
  });

  it('still reports the failure once the panel holding the composer is open', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(payload.slice(0, 2)) });
    vi.stubGlobal('fetch', rejectingFetch());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('Showing cached memos')).toBeTruthy());

    fireEvent.click(screen.getByText('Memos'));

    expect(screen.getByPlaceholderText('New memo…')).toBeTruthy();
    expect(screen.getByText('Showing cached memos')).toBeTruthy();
  });

  // "Showing cached memos" is usually on screen already on an offline day, so a
  // failed Add reported through that same line would change nothing visible.
  // A write failure gets its own line, next to the load's.
  it('reports a failed submit on its own line, in addition to the load failure', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(payload.slice(0, 2)) });
    vi.stubGlobal('fetch', rejectingFetch());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('Showing cached memos')).toBeTruthy());
    fireEvent.click(screen.getByText('Memos'));

    composeAndSubmit('call the bank');

    await waitFor(() => expect(screen.getByText('Not sent — kept as a draft')).toBeTruthy());
    expect(screen.getByText('Showing cached memos')).toBeTruthy();
  });

  it('reports a failed archive where it happened, in the compact view', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    vi.stubGlobal('fetch', respondWith(500, { code: 13, message: 'internal', details: [] }));
    fireEvent.click(screen.getAllByTitle('Mark done')[0]);

    await waitFor(() => expect(screen.getByText("Couldn't mark that done")).toBeTruthy());
    expect(screen.getByText('one')).toBeTruthy();
  });

  // The token is the cause the user can act on, so it wins over "not sent".
  it('explains a submit the server refused for the token with the token message', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
    fireEvent.click(screen.getByText('+1 more'));

    vi.stubGlobal('fetch', respondWith(401, UNAUTHENTICATED.body));
    composeAndSubmit('call the bank');

    await waitFor(() =>
      expect(
        screen.getByText('Your Memos token is invalid or has expired — reconnect in settings'),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('Not sent — kept as a draft')).toBeNull();
  });
});

describe('MemosWidget — refreshing', () => {
  // New tabs use the cache for a few minutes so the server is not asked twice
  // per tab. The button is how a memo written elsewhere arrives before then.
  it('asks the server again when refresh is pressed', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(payload.slice(0, 1)), memos_check: freshCheck() });
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Memos'));
    fireEvent.click(screen.getByTitle('Refresh'));

    await waitFor(() => expect(screen.getByText('two')).toBeTruthy());
  });
});
