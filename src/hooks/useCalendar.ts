import { useCallback, useEffect, useState } from 'react';

declare const chrome: {
  identity: {
    getAuthToken: (options: { interactive: boolean }, callback: (token: string) => void) => void;
  };
  runtime: {
    lastError?: { message: string };
  };
};

interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
}

export const useCalendar = (selectedCalendars: string[] = ['primary']) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(
    async (token: string) => {
      try {
        const now = new Date().toISOString();
        if (!selectedCalendars || selectedCalendars.length === 0) {
          setEvents([]);
          return;
        }

        const fetchPromises = selectedCalendars.map(async (calendarId) => {
          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${now}&maxResults=13&singleEvents=true&orderBy=startTime`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (!response.ok) {
            console.warn(`Nem sikerült lekérni a naptárat: ${calendarId}`);
            return [];
          }
          const data = await response.json();
          return data.items || [];
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
