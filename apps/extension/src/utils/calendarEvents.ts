import { format, parseISO } from 'date-fns';
import type { CalendarEvent } from '../types/calendar';

/** Upcoming events shown after the next one, so the widget stays a glance not a list. */
const FUTURE_EVENT_LIMIT = 3;

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
  if (event.hangoutLink) return event.hangoutLink;

  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && entry.uri,
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
