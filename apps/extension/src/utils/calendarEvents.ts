import { format, parseISO } from 'date-fns';
import type { CalendarEvent } from '../types/calendar';

/** Upcoming events shown after the next one, so the widget stays a glance not a list. */
const FUTURE_EVENT_LIMIT = 3;

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
