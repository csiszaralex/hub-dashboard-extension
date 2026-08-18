/**
 * One way into a conference. Google lists several per event — a video URL, a
 * dial-in number, an SIP address — distinguished by `entryPointType`.
 */
export interface ConferenceEntryPoint {
  entryPointType?: string;
  uri?: string;
  label?: string;
}

/**
 * Present when the conference was attached through Calendar's own UI or an
 * integration, which is how Zoom and Teams meetings arrive. Google Meet fills
 * `hangoutLink` as well; nothing else does.
 */
export interface ConferenceData {
  entryPoints?: ConferenceEntryPoint[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: ConferenceData;
  /** Timed events carry `dateTime`; all-day events carry `date`. */
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  calendarColor?: string;
}
