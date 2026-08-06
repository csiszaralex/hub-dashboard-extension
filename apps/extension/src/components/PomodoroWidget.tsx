import { Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePomodoro } from '../hooks/usePomodoro';
import { formatRemaining } from '../utils/pomodoro';

export const PomodoroWidget = () => {
  const { phase, running, remainingMs, ready, start, reset } = usePomodoro();
  const { t } = useTranslation();

  if (!ready) return null;

  return (
    <div className='flex items-center justify-center gap-6 text-white/90 bg-black/20 backdrop-blur-md px-10 py-5 rounded-3xl border border-white/10 shadow-2xl'>
      <div className='flex flex-col items-center'>
        <span className='text-5xl font-bold font-variant-numeric'>{formatRemaining(remainingMs)}</span>
        <span className='text-xs uppercase tracking-widest text-white/50 mt-1'>
          {t(phase === 'work' ? 'pomodoro.work' : 'pomodoro.break')}
        </span>
      </div>
      {/*
        There is no pause: the Pomodoro technique itself says finish the
        interval or abandon it, and the hook has no paused state to represent.
        This button only ever means "start", so it only ever shows the Play
        icon and the "start" title — disabled while running so it never
        implies an action (pause, restart) that does not exist. Reset (below)
        is the one and only way out mid-session.
      */}
      <button
        onClick={start}
        disabled={running}
        className='p-3 rounded-full bg-white/5 hover:bg-white/20 transition-colors disabled:opacity-30'
        title={t('pomodoro.start')}
      >
        <Play className='w-6 h-6' />
      </button>
      <button
        onClick={reset}
        className='p-3 rounded-full bg-white/5 hover:bg-white/20 transition-colors'
        title={t('pomodoro.reset')}
      >
        <RotateCcw className='w-6 h-6' />
      </button>
    </div>
  );
};
