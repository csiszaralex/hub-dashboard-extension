import { Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { usePomodoro } from '../hooks/usePomodoro';
import { formatRemaining, type PomodoroPhase } from '../utils/pomodoro';

// Kept inside the calendar/weather accent language (indigo-400,
// emerald, orange) rather than inventing a new colour: emerald reads as
// "go" for focus, orange as the warmer, slower tone for break. Both sit at
// low opacity so the pairing with `CountdownWidget`'s neutral white/10
// border still reads at a glance — a whisper of colour, not a repaint.
const PHASE_BORDER: Record<PomodoroPhase, string> = {
  work: 'border-emerald-400/30',
  break: 'border-orange-400/30',
};

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  work: 'text-emerald-300/80',
  break: 'text-orange-300/80',
};

export const PomodoroWidget = () => {
  const { phase, running, remainingMs, ready, start, reset } = usePomodoro();
  const { t } = useTranslation();

  // Only while running: idle is always the upcoming work length, not an
  // active phase worth announcing in the tab strip. Called unconditionally,
  // above the `ready` gate below, so hook order never depends on it.
  useDocumentTitle(
    running
      ? t(phase === 'work' ? 'pomodoro.titleWork' : 'pomodoro.titleBreak', {
          time: formatRemaining(remainingMs),
        })
      : null,
  );

  if (!ready) return null;

  return (
    <div
      className={`flex items-center justify-center gap-6 text-white/90 bg-black/20 backdrop-blur-md px-10 py-5 rounded-3xl border ${PHASE_BORDER[phase]} shadow-2xl`}
    >
      <div className='flex flex-col items-center'>
        <span className='text-5xl font-bold font-variant-numeric'>{formatRemaining(remainingMs)}</span>
        <span className={`text-xs uppercase tracking-widest ${PHASE_LABEL[phase]} mt-1`}>
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
