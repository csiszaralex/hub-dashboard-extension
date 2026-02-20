import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { BackgroundInfo } from './components/BackgroundInfo';
import { CalendarWidget } from './components/CalendarWidget';
import { Clock } from './components/Clock';
import { QuickNote } from './components/QuickNote';
import { QuoteWidget } from './components/QuoteWidget';
import { TopSitesWidget } from './components/TopSitesWidget';
import { UnsplashKeyPrompt } from './components/UnsplashKeyPrompt';
import { WeatherWidget } from './components/WeatherWidget';
import { useBackground } from './hooks/useBackground';

function App() {
  const [unsplashKey, setUnsplashKey] = useState(() => localStorage.getItem('unsplash_key') || '');
  const { bgData, refreshBackground, loading: bgLoading } = useBackground();
  const [uiVisible, setUiVisible] = useState(true);

  return (
    <main
      className='relative w-screen h-screen flex flex-col items-center justify-center text-white bg-cover bg-center transition-all duration-1000 overflow-hidden'
      style={{ backgroundImage: `url(${bgData.url})` }}
      onDoubleClick={() => setUiVisible(!uiVisible)}
    >
      <div
        className={`absolute inset-0 bg-black/30 pointer-events-none transition-opacity duration-1000 ${
          uiVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {!unsplashKey && (
        <UnsplashKeyPrompt
          onSave={(key: string) => {
            localStorage.setItem('unsplash_key', key);
            setUnsplashKey(key);
            setTimeout(() => refreshBackground(), 0);
          }}
        />
      )}

      <div
        className={`
          relative z-10 w-full h-full flex flex-col items-center justify-center transition-all duration-700 ease-in-out
          ${uiVisible ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-sm scale-105 pointer-events-none'}
        `}
      >
        <div className='flex flex-col items-center gap-6 mb-10'>
          <Clock />
          <QuoteWidget />
        </div>

        <CalendarWidget />
        <WeatherWidget />
        <TopSitesWidget />
        <QuickNote />

        {/* ALSÓ SÁV */}
        <div className='absolute bottom-4 left-4 flex items-end gap-3'>
          {/* HÁTTÉR FRISSÍTŐ GOMB */}
          <button
            onClick={() => refreshBackground()}
            disabled={bgLoading}
            className='p-2 rounded-full bg-black/20 hover:bg-white/20 backdrop-blur-sm transition-all disabled:opacity-50 group'
            title='Új háttérkép kérése'
          >
            <RefreshCw
              className={`w-4 h-4 text-white/70 group-hover:text-white ${bgLoading ? 'animate-spin' : ''}`}
            />
          </button>
          <BackgroundInfo data={bgData} />
        </div>
      </div>
    </main>
  );
}

export default App;

