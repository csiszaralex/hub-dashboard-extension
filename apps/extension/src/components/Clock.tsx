import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toLanguage } from '../i18n/language';
import { clockParts, DATE_LOCALES } from '../utils/localeFormat';

export const Clock = () => {
  const [time, setTime] = useState(new Date());
  const { t, i18n } = useTranslation();
  const language = toLanguage(i18n.language);
  const { hour, minute, dayPeriod } = clockParts(time, language);

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
    <div className='flex flex-col items-center select-none cursor-default group text-legible'>
      {/* Greeting - fading effect */}
      <div className='h-6 mb-1 text-lg font-light text-white/60 tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-500'>
        {getGreeting()}
      </div>

      {/* Clock - symmetric layout */}
      <div className='flex items-end leading-none tabular-nums'>
        <span className='text-8xl md:text-9xl font-bold tracking-tighter text-white'>
          {hour}
        </span>

        <span className='text-6xl md:text-7xl font-light text-white/50 mb-2 mx-1 animate-pulse'>
          {/* : */}
        </span>

        <span className='text-8xl md:text-9xl font-light tracking-tighter text-white/90'>
          {minute}
        </span>

        {/* AM/PM only where the language uses a 12-hour clock; small, so the digits stay the clock. */}
        {dayPeriod && (
          <span className='text-2xl md:text-3xl font-medium text-white/60 mb-3 ml-2'>{dayPeriod}</span>
        )}
      </div>

      {/* Date */}
      <div className='mt-3 text-white/70 font-medium tracking-[0.3em] uppercase text-sm md:text-base border-t border-white/10 pt-3 px-8'>
        {format(time, t('clock.dateFormat'), { locale: DATE_LOCALES[language] })}
      </div>
    </div>
  );
};
