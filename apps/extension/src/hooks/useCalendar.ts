import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../types/calendar';
import type { ICalendarList } from '../types/calendarList';
import {
  ask,
  CALENDAR_API,
  withCalendarToken,
  type NoToken,
  type Unauthorized,
} from '../utils/googleCalendar';

/** How often an open tab asks Google again. */
const REFRESH_MS = 30 * 60 * 1000;

const DEFAULT_COLOR = '#3b82f6';

/**
 * `signed-out` is no token without a prompt: the user never connected, or
 * Chrome has nothing cached for them. It keeps the plain "connect" nudge.
 *
 * `needs-sign-in` is the narrower case worth telling apart: Google rejected
 * the token this tab was using, and a fresh one could not be had without a
 * prompt, so the events the user was looking at are gone for a reason. Like
 * `MemosStatus`'s `needs-access`, the way back is one click on the widget,
 * which is the user gesture the interactive sign-in needs.
 *
 * `failed` is nothing loaded at all — offline, a timeout, Google erroring —
 * and must never read as a free day. A refresh that fails after a success
 * stays `ready` with the old events and `refreshFailed` set instead.
 */
export type CalendarStatus = 'loading' | 'signed-out' | 'needs-sign-in' | 'failed' | 'ready';

type Round = { kind: 'ok'; events: CalendarEvent[] } | Unauthorized | { kind: 'failed' };

/**
 * The calendar list (for colours) and one events feed per selected calendar.
 *
 * A 401 on any of them is about the token, so the whole round is. Any other
 * failure is about that one calendar — a deleted or unshared one answers 403
 * or 404 — and must not blank the others; only when no feed loaded is the
 * round a failure. The colour list is cosmetic: without it, events fall back
 * to the default colour.
 */
const loadRound = async (token: string, calendars: string[]): Promise<Round> => {
  const now = new Date().toISOString();
  const [colors, ...feeds] = await Promise.all([
    ask<{ items?: ICalendarList[] }>(`${CALENDAR_API}/users/me/calendarList`, token),
    ...calendars.map((calendarId) =>
      ask<{ items?: CalendarEvent[] }>(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${now}&maxResults=13&singleEvents=true&orderBy=startTime`,
        token,
      ),
    ),
  ]);

  if ([colors, ...feeds].some((answer) => answer.status === 401)) return { kind: 'unauthorized' };
  if (feeds.every((feed) => !feed.body)) return { kind: 'failed' };

  const colorMap = new Map<string, string>();
  for (const cal of colors.body?.items ?? []) {
    const id = cal.primary ? 'primary' : cal.id;
    if (cal.backgroundColor) colorMap.set(id, cal.backgroundColor);
  }

  const events = feeds.flatMap((feed, index) => {
    const color = colorMap.get(calendars[index]) || DEFAULT_COLOR;
    return (feed.body?.items ?? []).map((item) => ({ ...item, calendarColor: color }));
  });
  events.sort((a, b) => {
    const dateA = new Date(a.start.dateTime || a.start.date || 0).getTime();
    const dateB = new Date(b.start.dateTime || b.start.date || 0).getTime();
    return dateA - dateB;
  });
  return { kind: 'ok', events };
};

/**
 * A round under `withCalendarToken`'s token and 401 handling. With no calendars
 * selected there is nothing to ask, but the token is still fetched: it is what
 * tells a signed-in user with nothing selected from one who never connected.
 */
const fetchCalendar = (interactive: boolean, calendars: string[]): Promise<Round | NoToken> =>
  withCalendarToken<Round>(interactive, (token) =>
    calendars.length === 0
      ? Promise.resolve({ kind: 'ok', events: [] })
      : loadRound(token, calendars),
  );

/**
 * The calendar widget's data, held in memory only: the privacy policy promises
 * calendar data is not stored.
 */
export const useCalendar = (
  selectedCalendars: string[] = ['primary'],
  isSettingsLoaded: boolean = true,
) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [status, setStatus] = useState<CalendarStatus>('loading');
  const [refreshFailed, setRefreshFailed] = useState(false);

  /** Whether this tab has a successful result to fall back on when a refresh fails. */
  const hasLoaded = useRef(false);
  /** Bumped by every round, so only the latest one commits — the timer, a retry and a login can overlap. */
  const roundId = useRef(0);

  /** Puts a finished round on screen; the only place that touches this hook's state. */
  const commit = useCallback((round: Round | NoToken, interactive: boolean) => {
    if (round.kind === 'ok') {
      hasLoaded.current = true;
      setEvents(round.events);
      setRefreshFailed(false);
      setStatus('ready');
      return;
    }
    if (round.kind === 'failed') {
      if (hasLoaded.current) setRefreshFailed(true);
      else setStatus('failed');
      return;
    }
    // A closed sign-in prompt changes nothing.
    if (round.kind === 'no-token' && interactive) return;

    hasLoaded.current = false;
    setEvents([]);
    setRefreshFailed(false);
    // A timer finding no token after a rejection keeps saying why, rather than
    // falling back to the plain nudge.
    setStatus((prev) =>
      round.kind === 'unauthorized' || prev === 'needs-sign-in' ? 'needs-sign-in' : 'signed-out',
    );
  }, []);

  const run = useCallback(
    async (interactive: boolean) => {
      const id = ++roundId.current;
      const round = await fetchCalendar(interactive, selectedCalendars);
      if (id === roundId.current) commit(round, interactive);
    },
    [selectedCalendars, commit],
  );

  useEffect(() => {
    if (!isSettingsLoaded) return;

    const rounds = roundId;
    // Written out rather than calling `run`: the same steps, but with the
    // `await` in view of React's lint, which otherwise takes `run` for a
    // synchronous state update inside the effect.
    const load = async () => {
      const id = ++rounds.current;
      const round = await fetchCalendar(false, selectedCalendars);
      if (id === rounds.current) commit(round, false);
    };
    void load();
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(interval);
      // An answer for the calendars being replaced must not land afterwards.
      rounds.current++;
    };
  }, [selectedCalendars, isSettingsLoaded, commit]);

  /** The interactive sign-in. Call it from a click: that is the gesture its prompt needs. */
  const login = useCallback(() => void run(true), [run]);

  /** Asks again without a prompt, for the failure state's button. */
  const retry = useCallback(() => void run(false), [run]);

  return { status, events, refreshFailed, login, retry };
};
