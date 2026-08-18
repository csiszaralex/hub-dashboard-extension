import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

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
