import { useEffect, useState } from 'react';

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

export const useCalendar = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchEvents = async (token: string) => {
    try {
      // Csak a 'primary' naptárat nézzük
      // timeMin: mostantól
      // maxResults: 3 (hogy lássuk mi jön, de a widgeten csak 1-et mutatunk majd)
      // singleEvents: true (hogy a ismétlődő eseményeket kibontsa)
      // orderBy: startTime (hogy a legközelebbi legyen elől)
      const now = new Date().toISOString();
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&maxResults=13&singleEvents=true&orderBy=startTime`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) throw new Error('Calendar fetch failed');

      const data = await response.json();
      setEvents(data.items || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 1. Megnézzük, van-e már tokenünk (volt-e belépés)
    chrome.identity.getAuthToken({ interactive: false }, (token: string) => {
      if (chrome.runtime.lastError || !token) {
        setSignedIn(false);
        setLoading(false);
      } else {
        setSignedIn(true);
        fetchEvents(token);
      }
    });
  }, []);

  const login = () => {
    setLoading(true);
    // Interaktív belépés (popup ablak)
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
