import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChromeStub, installChromeStub } from '../test/chromeStub';
import { installFakeClock } from '../test/hangingFetch';
import { warmUp } from '../test/warmUp';

warmUp(() => Promise.all([import('../i18n/i18n'), import('./CalendarWidget')]));

const CALENDAR_LIST = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

/** Half an hour out, so `categorizeEvents` files it as the next event and renders a row. */
const soon = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString();

/**
 * Answers the two requests `useCalendar` makes: the calendar list for colours,
 * and one events feed per selected calendar.
 */
const stubCalendar = (event: Record<string, unknown>) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith(CALENDAR_LIST)) {
        return new Response(
          JSON.stringify({ items: [{ id: 'primary', primary: true, backgroundColor: '#123456' }] }),
        );
      }
      return new Response(JSON.stringify({ items: [event] }));
    }),
  );
};

const meeting = (extra: Record<string, unknown>) => ({
  id: 'sync',
  summary: 'Weekly sync',
  start: { dateTime: soon(30) },
  end: { dateTime: soon(60) },
  ...extra,
});

describe('CalendarWidget join button', () => {
  beforeEach(() => {
    installChromeStub().setAuthToken('token');
  });

  it('offers a way into a Zoom call attached as conference data', async () => {
    // The gap this closes. Only `hangoutLink` was read, so a Google Meet event
    // got a join button and an otherwise identical Zoom or Teams event — where
    // Google puts the URL under `conferenceData` instead — got nothing.
    stubCalendar(
      meeting({
        conferenceData: {
          entryPoints: [{ entryPointType: 'video', uri: 'https://example.zoom.us/j/123' }],
        },
      }),
    );
    // `EventRow` reads `i18n.language` on every render; without the binding
    // installed it is undefined and the component throws before it can render
    // a row at all.
    await import('../i18n/i18n');
    const { CalendarWidget } = await import('./CalendarWidget');

    render(<CalendarWidget />);

    const join = await waitFor(() => screen.getByRole('link', { name: /join/i }));
    expect(join.getAttribute('href')).toBe('https://example.zoom.us/j/123');
  });

  it('still offers the Google Meet link, which arrives on a different field', async () => {
    stubCalendar(meeting({ hangoutLink: 'https://meet.google.com/abc-defg-hij' }));
    // `EventRow` reads `i18n.language` on every render; without the binding
    // installed it is undefined and the component throws before it can render
    // a row at all.
    await import('../i18n/i18n');
    const { CalendarWidget } = await import('./CalendarWidget');

    render(<CalendarWidget />);

    const join = await waitFor(() => screen.getByRole('link', { name: /join/i }));
    expect(join.getAttribute('href')).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('renders no join button for a meeting with only a dial-in number', async () => {
    // A wrong or dead button is worse than none: the row must look exactly as
    // it did before when there is nothing a click could usefully open.
    stubCalendar(
      meeting({
        conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1-555-0100' }] },
      }),
    );
    // `EventRow` reads `i18n.language` on every render; without the binding
    // installed it is undefined and the component throws before it can render
    // a row at all.
    await import('../i18n/i18n');
    const { CalendarWidget } = await import('./CalendarWidget');

    render(<CalendarWidget />);

    await waitFor(() => expect(screen.getByText('Weekly sync')).not.toBeNull());
    expect(screen.queryByRole('link', { name: /join/i })).toBeNull();
  });
});

/** What one calendar's events feed answers: its events, or an HTTP error status. */
type Feed = Record<string, unknown>[] | number;

/**
 * Google, as far as `useCalendar` meets it: a 401 for any token the identity
 * stub says Google would not accept — on the calendar list as much as on the
 * feeds — and otherwise each calendar's feed as given. A calendar with no
 * entry answers 404, as a deleted one does.
 */
const google = (stub: ChromeStub, feeds: Record<string, Feed>) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization');
    if (!stub.acceptsToken(auth?.replace(/^Bearer /, '') ?? null)) {
      return new Response('{}', { status: 401 });
    }
    if (url.startsWith(CALENDAR_LIST)) {
      return new Response(
        JSON.stringify({ items: [{ id: 'primary', primary: true, backgroundColor: '#123456' }] }),
      );
    }
    const calendarId = decodeURIComponent(/\/calendars\/([^/]+)\/events/.exec(url)?.[1] ?? '');
    const feed = feeds[calendarId] ?? 404;
    if (typeof feed === 'number') return new Response('{}', { status: feed });
    return new Response(JSON.stringify({ items: feed }));
  });

const EMPTY_DAY = 'Empty calendar';

const renderWidget = async () => {
  await import('../i18n/i18n');
  const { CalendarWidget } = await import('./CalendarWidget');
  render(<CalendarWidget />);
};

describe('CalendarWidget when Google does not answer with events', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
    stub.setAuthToken('token-a');
  });

  it('renders the events Google sends', async () => {
    vi.stubGlobal('fetch', google(stub, { primary: [meeting({})] }));
    await renderWidget();

    await waitFor(() => expect(screen.getByText('Weekly sync')).not.toBeNull());
  });

  it('drops a rejected token from Chrome’s cache and loads with the fresh one', async () => {
    // Chrome keeps handing out a cached token until it is told otherwise; the
    // old hook never told it, so a dead token was reused for as long as Chrome
    // held it and every new tab claimed a free day.
    stub.expireCachedToken('token-b');
    vi.stubGlobal('fetch', google(stub, { primary: [meeting({})] }));
    await renderWidget();

    await waitFor(() => expect(screen.getByText('Weekly sync')).not.toBeNull());
    expect(stub.removedTokens()).toEqual(['token-a']);
  });

  it('asks for a sign-in on the widget once the grant is gone, and loads after it', async () => {
    stub.revokeGrant();
    stub.completePromptWith('token-c');
    vi.stubGlobal('fetch', google(stub, { primary: [meeting({})] }));
    await renderWidget();

    const button = await waitFor(() => screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.queryByText(EMPTY_DAY)).toBeNull();
    // One retry without a prompt, and no more: the round must not loop.
    expect(stub.authTokenRequests()).toEqual([{ interactive: false }, { interactive: false }]);

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('Weekly sync')).not.toBeNull());
    expect(stub.authTokenRequests().at(-1)).toEqual({ interactive: true });
  });

  it('says it could not load, not that the day is free, when offline from the start', async () => {
    // `setup.ts`'s default `fetch` rejects, as an offline browser does.
    await renderWidget();

    const retry = await waitFor(() => screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Could not load the calendar.')).not.toBeNull();
    expect(screen.queryByText(EMPTY_DAY)).toBeNull();

    vi.stubGlobal('fetch', google(stub, { primary: [meeting({})] }));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Weekly sync')).not.toBeNull());
  });

  // Arriving after the page has drawn, the failure has to be announced; a
  // plain paragraph is only found by someone who goes looking for it.
  it('announces the failure as an alert', async () => {
    await renderWidget();

    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the calendar.');
  });

  describe('on a fake clock', () => {
    let restoreClock: () => void;
    beforeEach(() => {
      restoreClock = installFakeClock();
    });
    afterEach(() => restoreClock());

    it('keeps the events it has, with a note, when a later refresh fails', async () => {
      vi.stubGlobal(
        'fetch',
        google(stub, {
          primary: [meeting({ start: { dateTime: soon(90) }, end: { dateTime: soon(120) } })],
        }),
      );
      await renderWidget();
      await waitFor(() => expect(screen.getByText('Weekly sync')).not.toBeNull());

      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
      // The hook's 30-minute refresh.
      await act(() => vi.advanceTimersByTimeAsync(30 * 60_000));

      await waitFor(() =>
        expect(screen.getByText('Could not refresh, showing earlier events.')).not.toBeNull(),
      );
      expect(screen.getByText('Weekly sync')).not.toBeNull();
    });
  });

  it('shows the calendars that loaded when another one is gone', async () => {
    stub.seedSync({ selectedCalendars: ['primary', 'team@example.com'] });
    vi.stubGlobal(
      'fetch',
      google(stub, { 'team@example.com': [meeting({ id: 'team', summary: 'Team review' })] }),
    );
    await renderWidget();

    await waitFor(() => expect(screen.getByText('Team review')).not.toBeNull());
  });

  it('still calls a day with nothing on it empty', async () => {
    vi.stubGlobal('fetch', google(stub, { primary: [] }));
    await renderWidget();

    await waitFor(() => expect(screen.getByText(EMPTY_DAY)).not.toBeNull());
    expect(screen.queryByRole('button')).toBeNull();
  });
});
