import { format } from 'date-fns';
import { enUS, hu } from 'date-fns/locale';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const Clock = () => {
  const [time, setTime] = useState(new Date());
  const { t, i18n } = useTranslation();
  const isHu = i18n.language.startsWith('hu');
  const dateLocale = isHu ? hu : enUS;
  const dateFormat = isHu ? 'MMMM d., EEEE' : 'MMMM d, EEEE';

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getGreeting = () => {
    const hour = time.getHours();
    if (hour < 5) return t('greeting.night');
    if (hour < 10) return t('greeting.morning');
    if (hour < 18) return t('greeting.day');
    return t('greeting.evening');
  };

  return (
    <div className='flex flex-col items-center select-none cursor-default group'>
      {/* Greeting - fading effect */}
      <div className='h-6 mb-1 text-lg font-light text-white/60 tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-500'>
        {getGreeting()}
      </div>

      {/* Clock - symmetric layout */}
      <div className='flex items-end leading-none font-variant-numeric drop-shadow-2xl'>
        <span className='text-8xl md:text-9xl font-bold tracking-tighter text-white'>
          {format(time, 'HH')}
        </span>

        <span className='text-6xl md:text-7xl font-light text-white/50 mb-2 mx-1 animate-pulse'>
          {/* : */}
        </span>

        <span className='text-8xl md:text-9xl font-light tracking-tighter text-white/90'>
          {format(time, 'mm')}
        </span>
      </div>

      {/* Date */}
      <div className='mt-3 text-white/70 font-medium tracking-[0.3em] uppercase text-sm md:text-base border-t border-white/10 pt-3 px-8'>
        {format(time, dateFormat, { locale: dateLocale })}
      </div>
    </div>
  );
};
