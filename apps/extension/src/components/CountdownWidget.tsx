import { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';

export const CountdownWidget = () => {
  const { settings, saveSettings } = useSettings();
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  useEffect(() => {
    if (!settings.countdownTarget) {
      if (timeLeft !== null) setTimeLeft(null);
      return;
    }

    const calculateTimeLeft = () => {
      const targetDate = new Date(settings.countdownTarget!).getTime();
      const now = new Date().getTime();
      const difference = targetDate - now;

      if (difference <= 0) {
        saveSettings({ countdownTarget: null });
        return null;
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    };

    const initialTimeLeft = calculateTimeLeft();
    setTimeLeft(initialTimeLeft);

    if (initialTimeLeft === null) return;

    const timer = setInterval(() => {
      const newTimeLeft = calculateTimeLeft();
      setTimeLeft(newTimeLeft);
      if (newTimeLeft === null) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [settings.countdownTarget, saveSettings]);

  if (!settings.countdownTarget || !timeLeft) return null;

  return (
    <div className='flex items-center justify-center gap-6 text-white/90 bg-black/20 backdrop-blur-md px-10 py-5 rounded-3xl border border-white/10 shadow-2xl'>
      <div className='flex flex-col items-center min-w-[4rem]'>
        <span className='text-5xl font-bold font-variant-numeric'>{timeLeft.days}</span>
        <span className='text-xs uppercase tracking-widest text-white/50 mt-1'>Nap</span>
      </div>
      <span className='text-4xl font-light text-white/30 pb-4'>:</span>
      <div className='flex flex-col items-center min-w-[4rem]'>
        <span className='text-5xl font-bold font-variant-numeric'>
          {timeLeft.hours.toString().padStart(2, '0')}
        </span>
        <span className='text-xs uppercase tracking-widest text-white/50 mt-1'>Óra</span>
      </div>
      <span className='text-4xl font-light text-white/30 pb-4'>:</span>
      <div className='flex flex-col items-center min-w-[4rem]'>
        <span className='text-5xl font-bold font-variant-numeric'>
          {timeLeft.minutes.toString().padStart(2, '0')}
        </span>
        <span className='text-xs uppercase tracking-widest text-white/50 mt-1'>Perc</span>
      </div>
      <span className='text-4xl font-light text-white/30 pb-4'>:</span>
      <div className='flex flex-col items-center min-w-[4rem]'>
        <span className='text-5xl font-bold font-variant-numeric'>
          {timeLeft.seconds.toString().padStart(2, '0')}
        </span>
        <span className='text-xs uppercase tracking-widest text-white/50 mt-1'>Mp</span>
      </div>
    </div>
  );
};
