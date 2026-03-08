import { useCallback, useEffect, useState } from 'react';
import type { ICalendarList } from '../types/calendarList';

declare const chrome: {
  identity: {
    getAuthToken: (options: { interactive: boolean }, callback: (token: string) => void) => void;
  };
  runtime: {
    lastError?: { message: string };
  };
};

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  calendarColor?: string;
}

export const useCalendar = (selectedCalendars: string[] = ['primary']) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(
    async (token: string) => {
      try {
        if (!selectedCalendars || selectedCalendars.length === 0) {
          setEvents([]);
          return;
        }

        const now = new Date().toISOString();

        // Párhuzamosan kérjük le a színeket (calendarList) és az eseményeket
        const [colorRes, ...eventResponses] = await Promise.all([
          fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          ...selectedCalendars.map((calendarId) =>
            fetch(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${now}&maxResults=13&singleEvents=true&orderBy=startTime`,
              { headers: { Authorization: `Bearer ${token}` } },
            ),
          ),
        ]);

        // Szín Map építése
        const colorMap = new Map<string, string>();
        if (colorRes.ok) {
          const colorData: { items: ICalendarList[] } = await colorRes.json();
          (colorData.items || []).forEach((cal) => {
            const id = cal.primary ? 'primary' : cal.id;
            if (cal.backgroundColor) colorMap.set(id, cal.backgroundColor);
          });
        }

        const fetchPromises = eventResponses.map(async (response, index) => {
          if (!response.ok) return [];
          const data = await response.json();
          const calendarId = selectedCalendars[index];
          const color = colorMap.get(calendarId) || '#3b82f6';

          return (data.items || []).map((item: CalendarEvent) => ({
            ...item,
            calendarColor: color,
          }));
        });

        const results = await Promise.all(fetchPromises);
        const mergedEvents = results.flat();

        mergedEvents.sort((a, b) => {
          const dateA = new Date(a.start.dateTime || a.start.date || 0).getTime();
          const dateB = new Date(b.start.dateTime || b.start.date || 0).getTime();
          return dateA - dateB;
        });

        setEvents(mergedEvents);
      } catch (error) {
        console.error('Calendar fetch failed:', error);
      } finally {
        setLoading(false);
      }
    },
    [selectedCalendars],
  );

  useEffect(() => {
    setLoading(true);
    chrome.identity.getAuthToken({ interactive: false }, (token: string) => {
      if (chrome.runtime.lastError || !token) {
        setSignedIn(false);
        setLoading(false);
      } else {
        setSignedIn(true);
        fetchEvents(token);
      }
    });
  }, [fetchEvents]);

  const login = () => {
    setLoading(true);
    chrome.identity.getAuthToken({ interactive: true }, (token: string) => {
      if (chrome.runtime.lastError || !token) {
        console.error(chrome.runtime.lastError);
        setLoading(false);
        return;
      }
      setSignedIn(true);
      fetchEvents(token);
    });
  };

  return { events, signedIn, login, loading };
};
