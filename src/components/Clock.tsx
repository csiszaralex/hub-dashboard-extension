import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useEffect, useState } from 'react';

export const Clock = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getGreeting = () => {
    const hour = time.getHours();
    if (hour < 5) return 'Jó pihenést'; // Éjjel baglyoknak
    if (hour < 10) return 'Jó reggelt';
    if (hour < 18) return 'Szép napot';
    return 'Kellemes estét';
  };

  return (
    <div className='flex flex-col items-center select-none cursor-default group'>
      {/* Köszönés - Fading effekt */}
      <div className='h-6 mb-1 text-lg font-light text-white/60 tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-500'>
        {getGreeting()}
      </div>

      {/* ÓRA - Szimmetrikus elrendezés */}
      <div className='flex items-end leading-none font-variant-numeric drop-shadow-2xl'>
        {/* Óra: HH (00-23) */}
        <span className='text-8xl md:text-9xl font-bold tracking-tighter text-white'>
          {format(time, 'HH')}
        </span>

        {/* Villogó kettőspont (opcionális hangulat elem) */}
        <span className='text-6xl md:text-7xl font-light text-white/50 mb-2 mx-1 animate-pulse'>
          {/* : */}
        </span>

        {/* Perc: mm (00-59) */}
        <span className='text-8xl md:text-9xl font-light tracking-tighter text-white/90'>
          {format(time, 'mm')}
        </span>
      </div>

      {/* Dátum */}
      <div className='mt-3 text-white/70 font-medium tracking-[0.3em] uppercase text-sm md:text-base border-t border-white/10 pt-3 px-8'>
        {format(time, 'MMMM d., EEEE', { locale: hu })}
      </div>
    </div>
  );
};
