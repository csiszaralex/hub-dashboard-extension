import type { ICalendarList } from '../types/calendarList';
import { fetchWithTimeout } from './fetchWithTimeout';

/**
 * Talking to the Google Calendar API: a token from `chrome.identity`, a request
 * with it, and what to do when Google no longer accepts it. Shared by the
 * widget's `useCalendar` and the popup's calendar picker, so both recover from
 * a stale token the same way.
 */
export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** A request's HTTP status and body; status `0` is one that never got an answer. */
export interface Answer<T> {
  status: number;
  body: T | null;
}

export const ask = async <T>(url: string, token: string): Promise<Answer<T>> => {
  try {
    return await fetchWithTimeout(
      url,
      async (res) => ({ status: res.status, body: res.ok ? ((await res.json()) as T) : null }),
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (error) {
    // Offline, or out of time (`FetchTimeoutError`): no answer, not an empty one.
    console.error('Calendar fetch failed:', error);
    return { status: 0, body: null };
  }
};

/**
 * The Promise form, which rejects on failure. The callback form reports it
 * through `runtime.lastError` instead, and hands the token over as a bare first
 * argument, where `@types/chrome` claims a result object.
 */
const getToken = async (interactive: boolean): Promise<string | null> => {
  try {
    const { token } = await chrome.identity.getAuthToken({ interactive });
    return token || null;
  } catch {
    return null;
  }
};

export type Unauthorized = { kind: 'unauthorized' };
export type NoToken = { kind: 'no-token' };

/**
 * A token, then a round with it. Chrome keeps handing out a cached token
 * Google no longer accepts, so a 401 means telling Chrome to drop it and
 * trying once more without a prompt — once, never a loop. A second rejected
 * token is dropped too, so the next sign-in starts clean.
 */
export const withCalendarToken = async <R extends { kind: string }>(
  interactive: boolean,
  round: (token: string) => Promise<R | Unauthorized>,
): Promise<R | Unauthorized | NoToken> => {
  let token = await getToken(interactive);
  if (!token) return { kind: 'no-token' };

  const first = await round(token);
  if (first.kind !== 'unauthorized') return first;

  await chrome.identity.removeCachedAuthToken({ token }).catch(() => undefined);
  token = await getToken(false);
  if (!token) return first;

  const retried = await round(token);
  if (retried.kind === 'unauthorized') {
    await chrome.identity.removeCachedAuthToken({ token }).catch(() => undefined);
  }
  return retried;
};

/** One calendar as the popup's picker offers it. */
export interface CalendarListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
}

export type CalendarListResult =
  | { kind: 'ok'; calendars: CalendarListEntry[] }
  | { kind: 'failed'; status: number }
  | Unauthorized
  | NoToken;

/**
 * The user's calendars, for choosing which ones the widget shows.
 *
 * The primary calendar is listed under the id `primary` rather than its address,
 * because that is the id `selectedCalendars` holds by default and `useCalendar`
 * asks for its events by.
 */
export const fetchCalendarList = (interactive: boolean): Promise<CalendarListResult> =>
  withCalendarToken(interactive, async (token) => {
    const answer = await ask<{ items?: ICalendarList[] }>(
      `${CALENDAR_API}/users/me/calendarList`,
      token,
    );
    if (answer.status === 401) return { kind: 'unauthorized' };
    if (!answer.body) return { kind: 'failed', status: answer.status };
    return {
      kind: 'ok',
      calendars: (answer.body.items ?? []).map((cal) => ({
        id: cal.primary ? 'primary' : cal.id,
        summary: cal.summary,
        backgroundColor: cal.backgroundColor,
      })),
    };
  });
