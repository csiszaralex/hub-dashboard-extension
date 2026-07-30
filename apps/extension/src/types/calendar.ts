export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  hangoutLink?: string;
  /** Timed events carry `dateTime`; all-day events carry `date`. */
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  calendarColor?: string;
}
