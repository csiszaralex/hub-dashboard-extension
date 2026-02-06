import { useState } from 'react';
import { BackgroundInfo } from './components/BackgroundInfo';
import { Clock } from './components/Clock';
import { QuickNote } from './components/QuickNote';
import { QuoteWidget } from './components/QuoteWidget';
import { TopSitesWidget } from './components/TopSitesWidget';
import { WeatherWidget } from './components/WeatherWidget';
import { useBackground } from './hooks/useBackground';
import { CalendarWidget } from './components/CalendarWidget';

function App() {
  const bgData = useBackground();
  const [uiVisible, setUiVisible] = useState(true);

  return (
    <main
      className='relative w-screen h-screen flex flex-col items-center justify-center text-white bg-cover bg-center transition-all duration-1000 overflow-hidden'
      style={{ backgroundImage: `url(${bgData.url})` }}
      onDoubleClick={() => setUiVisible(!uiVisible)}
    >
      {/* Overlay: Ezt is elhalványítjuk Zen módban, hogy
         a kép teljes pompájában látszódjon (sötétítés nélkül).
      */}
      <div
        className={`absolute inset-0 bg-black/30 pointer-events-none transition-opacity duration-1000 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Content Wrapper: Ez kezeli az eltűnést.
         Fontos: pointer-events-none kell, ha rejtett, különben rákattintasz véletlenül.
      */}
      <div
        className={`
          relative z-10 w-full h-full flex flex-col items-center justify-center transition-all duration-700 ease-in-out
          ${uiVisible ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-sm scale-105 pointer-events-none'}
        `}
      >
        {/* Felső/Középső szekció */}
        <div className='flex flex-col items-center gap-6 mb-10'>
          <Clock />
          <QuoteWidget />
        </div>

        {/* Abszolút pozícionált elemek */}
        <CalendarWidget />
        <WeatherWidget />
        <TopSitesWidget />
        <QuickNote />

        {/* Bal alulra pozícionálva, ahogy beszéltük */}
        <div className='absolute bottom-4 left-4'>
          <BackgroundInfo data={bgData} />
        </div>
      </div>
    </main>
  );
}

export default App;

