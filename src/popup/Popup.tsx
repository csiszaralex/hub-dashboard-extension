import { useState } from 'react';
import { useSettings, type HubSettings } from '../hooks/useSettings';

function PopupForm({
  initialSettings,
  onSave,
}: {
  initialSettings: HubSettings;
  onSave: (settings: Partial<HubSettings>) => void;
}) {
  const [key, setKey] = useState(initialSettings.unsplashKey);
  const [query, setQuery] = useState(initialSettings.unsplashQuery);
  const [city, setCity] = useState(initialSettings.locationCity);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
          validCity = data.results[0].name; // Normalizált név
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
      unsplashKey: key.trim(),
      unsplashQuery: query.trim(),
      locationCity: validCity,
      locationLat: lat,
      locationLon: lon,
    });

    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1.5'>
        <label
          htmlFor='apiKey'
          className='text-xs font-medium text-white/70 uppercase tracking-wider'
        >
          Unsplash API Kulcs
        </label>
        <input
          id='apiKey'
          type='text'
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className='px-3 py-2 rounded-md bg-zinc-900 border border-white/10 focus:outline-none focus:border-white/30 transition-colors text-sm'
          placeholder='Access Key'
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <label
          htmlFor='query'
          className='text-xs font-medium text-white/70 uppercase tracking-wider'
        >
          Háttér témája
        </label>
        <input
          id='query'
          type='text'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='px-3 py-2 rounded-md bg-zinc-900 border border-white/10 focus:outline-none focus:border-white/30 transition-colors text-sm'
          placeholder='pl. landscape, dark, city'
        />
        <p className='text-[10px] text-white/40 mt-1'>Vesszővel elválasztott angol kifejezések.</p>
      </div>

      <div className='flex flex-col gap-1.5'>
        <label
          htmlFor='city'
          className='text-xs font-medium text-white/70 uppercase tracking-wider'
        >
          Időjárás helyszíne
        </label>
        <input
          id='city'
          type='text'
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={`px-3 py-2 rounded-md bg-zinc-900 border focus:outline-none transition-colors text-sm ${
            error
              ? 'border-red-500/50 focus:border-red-500'
              : 'border-white/10 focus:border-white/30'
          }`}
          placeholder='Opcionális (pl. Budapest)'
        />
        {error ? (
          <p className='text-[10px] text-red-400 mt-1'>{error}</p>
        ) : (
          <p className='text-[10px] text-white/40 mt-1'>
            Üresen hagyva automatikus GPS/IP alapján.
          </p>
        )}
      </div>

      <button
        type='submit'
        disabled={loading}
        className='mt-2 w-full bg-white/10 hover:bg-white/20 transition-colors py-2.5 rounded-md text-sm font-medium disabled:opacity-50'
      >
        {loading ? 'Ellenőrzés...' : saved ? 'Sikeresen mentve!' : 'Mentés'}
      </button>
    </form>
  );
}

export function Popup() {
  const { settings, isLoaded, saveSettings } = useSettings();

  if (!isLoaded)
    return (
      <div className='flex items-center justify-center h-40 bg-zinc-950 text-white/50 text-sm'>
        Betöltés...
      </div>
    );

  return (
    <div className='p-5 bg-zinc-950 text-white flex flex-col gap-5'>
      <h2 className='text-lg font-medium border-b border-white/10 pb-2'>Hub Beállítások</h2>
      <PopupForm initialSettings={settings} onSave={saveSettings} />
    </div>
  );
}
