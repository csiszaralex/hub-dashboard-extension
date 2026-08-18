import { format, parseISO } from 'date-fns';
import type { CalendarEvent } from '../types/calendar';

/** Upcoming events shown after the next one, so the widget stays a glance not a list. */
const FUTURE_EVENT_LIMIT = 3;

/**
 * Whether a string is safe to put in an `href` the user can click.
 *
 * This is a security boundary, not tidiness. The result is rendered on a
 * `chrome-extension://` page, so a `javascript:` URI would execute with the
 * extension's own origin on click — reaching `chrome.storage`, the Cache API
 * and everything else the page can touch. Conference entry points are written
 * by whoever created the event, which for an invitation is not the user, so
 * they are untrusted input however trustworthy the transport.
 *
 * Parsed with `URL` rather than matched as a string: the parser strips tab and
 * newline characters before reading the scheme, so `java\tscript:` and
 * `JavaScript:` both normalise to the same thing a naive `startsWith` check
 * would wave through. An unparseable string is rejected too — a relative URL
 * is not a meeting anyone can join.
 */
const isJoinableUrl = (uri: string | undefined): boolean => {
  if (!uri) return false;

  try {
    const { protocol } = new URL(uri);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * The URL that joins an event's call, or null when there is nothing to join.
 *
 * Two sources, because Google populates them differently. `hangoutLink` is set
 * for Google Meet and nothing else; a conference attached through Calendar's UI
 * or an integration — which is how Zoom and Teams meetings arrive — appears only
 * under `conferenceData.entryPoints`. Reading the first alone made the join
 * button a Google-only feature on a widget that shows every calendar.
 *
 * Only `video` entry points qualify. The same list carries dial-in numbers and
 * SIP addresses, and a button that opens `tel:` from a dashboard is not what
 * anyone means by joining a call.
 *
 * Deliberately does not scrape the description or location for URLs. Those hold
 * links to agendas, documents and previous meetings, and a join button that
 * opens the wrong one is worse than no button — the user finds out only after
 * the tab has taken over their screen.
 */
export const meetingLink = (event: CalendarEvent): string | null => {
  if (isJoinableUrl(event.hangoutLink)) return event.hangoutLink!;

  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && isJoinableUrl(entry.uri),
  );

  return video?.uri ?? null;
};

export interface CategorizedEvents {
  allDayEvents: CalendarEvent[];
  currentEvents: CalendarEvent[];
  nextEvent: CalendarEvent | null;
  futureEvents: CalendarEvent[];
}

/**
 * Splits the calendar feed into the buckets the widget renders.
 *
 * All-day events are compared as plain `YYYY-MM-DD` strings because Google
 * reports them without a time zone, and `end.date` is exclusive.
 */
export const categorizeEvents = (events: CalendarEvent[], now: Date): CategorizedEvents => {
  const todayStr = format(now, 'yyyy-MM-dd');

  const allDayEvents: CalendarEvent[] = [];
  const timed: CalendarEvent[] = [];

  for (const event of events) {
    if (event.start.date && event.end.date) {
      if (event.start.date <= todayStr && event.end.date > todayStr) allDayEvents.push(event);
    } else if (event.start.dateTime) {
      timed.push(event);
    }
  }

  const currentEvents: CalendarEvent[] = [];
  const upcoming: CalendarEvent[] = [];

  for (const event of timed) {
    const start = parseISO(event.start.dateTime!);
    const end = parseISO(event.end.dateTime!);

    if (start <= now && end > now) currentEvents.push(event);
    else if (start > now) upcoming.push(event);
  }

  currentEvents.sort(
    (a, b) => parseISO(a.end.dateTime!).getTime() - parseISO(b.end.dateTime!).getTime(),
  );
  upcoming.sort(
    (a, b) => parseISO(a.start.dateTime!).getTime() - parseISO(b.start.dateTime!).getTime(),
  );

  return {
    allDayEvents,
    currentEvents,
    nextEvent: upcoming[0] ?? null,
    futureEvents: upcoming.slice(1, 1 + FUTURE_EVENT_LIMIT),
  };
};
