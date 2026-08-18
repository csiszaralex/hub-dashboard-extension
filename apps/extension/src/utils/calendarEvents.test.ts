import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../types/calendar';
import { categorizeEvents, meetingLink } from './calendarEvents';

// Fixed local "now": Wednesday 29 July 2026, 10:00.
const NOW = new Date(2026, 6, 29, 10, 0, 0);

const timed = (id: string, start: string, end: string): CalendarEvent => ({
  id,
  summary: id,
  start: { dateTime: start },
  end: { dateTime: end },
});

const allDay = (id: string, start: string, end: string): CalendarEvent => ({
  id,
  summary: id,
  start: { date: start },
  end: { date: end },
});

describe('categorizeEvents', () => {
  it('treats an event that has started but not ended as current', () => {
    const event = timed('standup', '2026-07-29T09:30:00', '2026-07-29T10:30:00');

    const { currentEvents } = categorizeEvents([event], NOW);

    expect(currentEvents.map((e) => e.id)).toEqual(['standup']);
  });

  it('picks the earliest upcoming event as the next one', () => {
    const events = [
      timed('later', '2026-07-29T15:00:00', '2026-07-29T16:00:00'),
      timed('sooner', '2026-07-29T11:00:00', '2026-07-29T12:00:00'),
    ];

    const { nextEvent } = categorizeEvents(events, NOW);

    expect(nextEvent?.id).toBe('sooner');
  });

  it('shows at most three events beyond the next one', () => {
    const events = ['11', '12', '13', '14', '15'].map((hour) =>
      timed(hour, `2026-07-29T${hour}:00:00`, `2026-07-29T${hour}:30:00`),
    );

    const { futureEvents } = categorizeEvents(events, NOW);

    expect(futureEvents.map((e) => e.id)).toEqual(['12', '13', '14']);
  });

  it('orders concurrent current events by the one finishing first', () => {
    const events = [
      timed('long', '2026-07-29T09:00:00', '2026-07-29T12:00:00'),
      timed('short', '2026-07-29T09:00:00', '2026-07-29T10:30:00'),
    ];

    const { currentEvents } = categorizeEvents(events, NOW);

    expect(currentEvents.map((e) => e.id)).toEqual(['short', 'long']);
  });

  it('includes an all-day event that covers today', () => {
    const { allDayEvents } = categorizeEvents([allDay('trip', '2026-07-29', '2026-07-31')], NOW);

    expect(allDayEvents.map((e) => e.id)).toEqual(['trip']);
  });

  it('excludes an all-day event that ended before today', () => {
    const { allDayEvents } = categorizeEvents([allDay('past', '2026-07-27', '2026-07-29')], NOW);

    expect(allDayEvents).toEqual([]);
  });

  it('excludes an all-day event that has not started yet', () => {
    const { allDayEvents } = categorizeEvents([allDay('future', '2026-07-30', '2026-07-31')], NOW);

    expect(allDayEvents).toEqual([]);
  });

  it('leaves every bucket empty for an empty calendar', () => {
    expect(categorizeEvents([], NOW)).toEqual({
      allDayEvents: [],
      currentEvents: [],
      nextEvent: null,
      futureEvents: [],
    });
  });

  it('ignores events that ended before now', () => {
    const event = timed('done', '2026-07-29T08:00:00', '2026-07-29T09:00:00');

    const { currentEvents, nextEvent, futureEvents } = categorizeEvents([event], NOW);

    expect([...currentEvents, ...futureEvents]).toEqual([]);
    expect(nextEvent).toBeNull();
  });
});

const withConference = (entryPoints: unknown[]): CalendarEvent => ({
  id: 'call',
  summary: 'call',
  start: { dateTime: '2026-07-29T11:00:00' },
  end: { dateTime: '2026-07-29T12:00:00' },
  conferenceData: { entryPoints } as CalendarEvent['conferenceData'],
});

describe('meetingLink', () => {
  it('returns the Meet link when Google supplies one directly', () => {
    const event = timed('standup', '2026-07-29T11:00:00', '2026-07-29T11:30:00');
    event.hangoutLink = 'https://meet.google.com/abc-defg-hij';

    expect(meetingLink(event)).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('finds a Zoom link that arrived as conference data rather than a hangout link', () => {
    // Conferences added through an integration — Zoom, Teams — populate
    // `conferenceData` and leave `hangoutLink` unset, which is why reading only
    // the latter made the join button a Google-only feature.
    const event = withConference([
      { entryPointType: 'video', uri: 'https://example.zoom.us/j/123' },
    ]);

    expect(meetingLink(event)).toBe('https://example.zoom.us/j/123');
  });

  it('ignores dial-in numbers, which are not something a button can open', () => {
    const event = withConference([
      { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
      { entryPointType: 'video', uri: 'https://teams.microsoft.com/l/meetup/xyz' },
    ]);

    expect(meetingLink(event)).toBe('https://teams.microsoft.com/l/meetup/xyz');
  });

  it('prefers the hangout link when an event carries both', () => {
    const event = withConference([
      { entryPointType: 'video', uri: 'https://example.zoom.us/j/123' },
    ]);
    event.hangoutLink = 'https://meet.google.com/abc-defg-hij';

    expect(meetingLink(event)).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('returns null for an event with no conference at all', () => {
    expect(meetingLink(timed('lunch', '2026-07-29T12:00:00', '2026-07-29T13:00:00'))).toBeNull();
  });

  it('returns null when conference data carries no usable video entry', () => {
    // A wrong link is worse than no button: an entry with no uri, or only a
    // dial-in, must leave the event looking exactly as it does today.
    expect(meetingLink(withConference([{ entryPointType: 'video' }]))).toBeNull();
    expect(meetingLink(withConference([{ entryPointType: 'phone', uri: 'tel:+1' }]))).toBeNull();
    expect(meetingLink(withConference([]))).toBeNull();
  });
});
