import { useCallback, useEffect, useState } from 'react';
import { useSettings, type HubSettings } from '../hooks/useSettings';

declare const chrome: {
  identity: {
    getAuthToken: (options: { interactive: boolean }, callback: (token: string) => void) => void;
  };
  runtime: {
    lastError?: { message: string };
  };
};

interface CalendarListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
}

function PopupForm({
  initialSettings,
  onSave,
}: {
  initialSettings: HubSettings;
  onSave: (settings: Partial<HubSettings>) => void;
}) {
  const [query, setQuery] = useState(initialSettings.unsplashQuery);
  const [city, setCity] = useState(initialSettings.locationCity);
  const [selectedCals, setSelectedCals] = useState<string[]>(initialSettings.selectedCalendars);
  const [countdownTarget, setCountdownTarget] = useState(initialSettings.countdownTarget || '');

  const [availableCals, setAvailableCals] = useState<CalendarListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  const loadCalendars = useCallback((interactive = false) => {
    chrome.identity.getAuthToken({ interactive }, async (token: string) => {
      setCalError(null);
      if (chrome.runtime.lastError || !token) {
        const errorMsg = chrome.runtime.lastError?.message || 'Nincs token.';
        console.error('Auth hiba a popupban:', errorMsg);
        setCalError(`Auth hiba: ${errorMsg}`);
        return;
      }

      try {
        const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          const normalizedItems = (data.items || []).map(
            (cal: CalendarListEntry & { primary: boolean }) =>
              cal.primary ? { ...cal, id: 'primary' } : cal,
          );
          setAvailableCals(normalizedItems);
        } else {
          const errText = await res.text();
          console.error('API hiba:', errText);
          setCalError(`API hiba: ${res.status}`);
        }
      } catch (e) {
        console.error('Fetch hiba:', e);
        setCalError('Hálózati hiba a naptárak lekérésekor.');
      }
    });
  }, []);

  useEffect(() => {
    loadCalendars(false);
  }, [loadCalendars]);

  const toggleCalendar = (calendarId: string) => {
    setSelectedCals((prev) =>
      prev.includes(calendarId) ? prev.filter((id) => id !== calendarId) : [...prev, calendarId],
    );
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let lat = initialSettings.locationLat;
    let lon = initialSettings.locationLon;
    let validCity = city.trim();

    if (validCity && validCity !== initialSettings.locationCity) {
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(validCity)}&count=1&language=en&format=json`,
        );
        const data = await res.json();

        if (data.results && data.results.length > 0) {
          lat = data.results[0].latitude;
          lon = data.results[0].longitude;
          validCity = data.results[0].name;
          setCity(validCity);
        } else {
          setError('A megadott város nem található.');
          setLoading(false);
          return;
        }
      } catch {
        setError('Hiba a város azonosítása során.');
        setLoading(false);
        return;
      }
    } else if (!validCity) {
      lat = null;
      lon = null;
    }

    onSave({
      unsplashQuery: query.trim(),
      locationCity: validCity,
      locationLat: lat,
      locationLon: lon,
      selectedCalendars: selectedCals,
      countdownTarget: countdownTarget || null,
    });

    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-4 min-w-0'>
      <div className='bg-white/5 border border-white/5 p-3.5 rounded-lg flex flex-col gap-2 min-w-0'>
        <label
          htmlFor='query'
          className='text-xs font-semibold text-white/80 uppercase tracking-wider'
        >
          Kinézet & Háttér
        </label>
        <input
          id='query'
          type='text'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='w-full min-w-0 px-3 py-2 rounded bg-black/40 border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm'
          placeholder='pl. landscape, dark, city'
        />
        <p className='text-[10px] text-white/40'>Angol kifejezések, vesszővel elválasztva.</p>
      </div>

      <div className='bg-white/5 border border-white/5 p-3.5 rounded-lg flex flex-col gap-2 min-w-0'>
        <label
          htmlFor='city'
          className='text-xs font-semibold text-white/80 uppercase tracking-wider'
        >
          Időjárás Lokáció
        </label>
        <input
          id='city'
          type='text'
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={`w-full min-w-0 px-3 py-2 rounded bg-black/40 border focus:outline-none focus:ring-1 transition-all text-sm ${
            error
              ? 'border-red-500/50 focus:ring-red-500/50'
              : 'border-white/10 focus:ring-white/30'
          }`}
          placeholder='Opcionális (pl. Budapest)'
        />
        {error ? (
          <p className='text-[10px] text-red-400'>{error}</p>
        ) : (
          <p className='text-[10px] text-white/40'>Üresen hagyva automatikus (IP alapján).</p>
        )}
      </div>

      <div className='bg-white/5 border border-white/5 p-3.5 rounded-lg flex flex-col gap-2 min-w-0'>
        <label
          htmlFor='countdownTarget'
          className='text-xs font-semibold text-white/80 uppercase tracking-wider'
        >
          Fókusz Visszaszámláló
        </label>
        <input
          id='countdownTarget'
          type='datetime-local'
          value={countdownTarget}
          onChange={(e) => setCountdownTarget(e.target.value)}
          className='w-full min-w-0 px-3 py-2 rounded bg-black/40 border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm text-white scheme-dark'
        />
        <p className='text-[10px] text-white/40'>Ha a megadott idő letelik, a számláló eltűnik.</p>
      </div>

      <div className='bg-white/5 border border-white/5 p-3.5 rounded-lg flex flex-col gap-3 min-w-0'>
        <div className='flex justify-between items-center'>
          <label className='text-xs font-semibold text-white/80 uppercase tracking-wider'>
            Naptárak
          </label>
          <button
            type='button'
            onClick={() => loadCalendars(true)}
            className='text-[10px] font-medium bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded transition-colors shrink-0'
          >
            Google Belépés / Frissítés
          </button>
        </div>

        {calError && (
          <p className='text-[10px] text-red-400 bg-red-500/10 p-2 rounded'>{calError}</p>
        )}

        {availableCals.length > 0 ? (
          <div className='flex flex-col gap-1 min-w-0'>
            {availableCals.map((cal) => (
              <label
                key={cal.id}
                className='flex items-center gap-2.5 cursor-pointer hover:bg-white/5 p-2 rounded-md transition-colors min-w-0'
              >
                <input
                  type='checkbox'
                  checked={selectedCals.includes(cal.id)}
                  onChange={() => toggleCalendar(cal.id)}
                  className='accent-white/70 w-3.5 h-3.5 rounded border-white/20 bg-zinc-900 cursor-pointer shrink-0'
                />
                <div
                  className='w-2.5 h-2.5 rounded-full shrink-0'
                  style={{ backgroundColor: cal.backgroundColor || '#ccc' }}
                />
                <span className='text-sm text-white/90 truncate select-none min-w-0 flex-1'>
                  {cal.summary}
                </span>
              </label>
            ))}
          </div>
        ) : (
          !calError && (
            <p className='text-[10px] text-white/40 italic'>Naptárak betöltése folyamatban...</p>
          )
        )}
      </div>

      <button
        type='submit'
        disabled={loading}
        className='mt-2 w-full bg-white text-black hover:bg-white/90 transition-colors py-2.5 rounded-md text-sm font-semibold disabled:opacity-50'
      >
        {loading ? 'Mentés...' : saved ? '✓ Sikeresen mentve!' : 'Beállítások alkalmazása'}
      </button>
    </form>
  );
}

export function Popup() {
  const { settings, isLoaded, saveSettings } = useSettings();

  if (!isLoaded)
    return (
      <div className='w-85 flex items-center justify-center h-40 bg-zinc-950 text-white/50 text-sm'>
        Betöltés...
      </div>
    );

  return (
    <div className='w-85 p-5 bg-zinc-950 text-white flex flex-col gap-4 overflow-hidden box-border'>
      <h2 className='text-lg font-semibold text-white/90 border-b border-white/10 pb-3'>
        Hub Dashboard
      </h2>
      <PopupForm initialSettings={settings} onSave={saveSettings} />
    </div>
  );
}
