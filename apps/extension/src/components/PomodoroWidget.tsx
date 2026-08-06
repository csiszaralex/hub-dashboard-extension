import { Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePomodoro } from '../hooks/usePomodoro';
import { formatRemaining } from '../utils/pomodoro';

// Position, checked against every other `absolute`-positioned element in
// `App.tsx` for widths from ~700px (about as narrow as a Chrome window gets)
// up through a wide desktop:
// - `bottom-8 left-8` (the brief's original proposal) sits on top of the
//   refresh button + photo credit at `bottom-4 left-4`: that block's text can
//   run two lines tall, reaching past the 32px `bottom-8` offset.
// - `bottom-20 left-8` (an earlier attempt) clears that block but not
//   `QuoteWidget`, which is centred (`left-1/2 -translate-x-1/2`) and, at
//   `max-w-3xl`, is exactly 768px wide once the window is wide enough to
//   afford it. Below ~1280px window width, its left edge sits under 260px
//   from the screen edge — inside this widget's horizontal span — and the two
//   occupy overlapping vertical bands (quote: `bottom-5` up to roughly 170px
//   tall for the longest bundled fallback quote wrapped at that width; this
//   widget at `bottom-20`: 80px to ~146px). `App.tsx` paints this widget after
//   the quote with no z-index, so it would win the overlap.
// `bottom-48` (192px) clears the quote's realistic maximum height outright,
// which makes the fix independent of window width rather than valid only
// above some breakpoint, while keeping the same `left-8` column as the other
// pill widgets (Calendar, Weather).
export const PomodoroWidget = () => {
  const { phase, running, remainingMs, ready, start, reset } = usePomodoro();
  const { t } = useTranslation();

  if (!ready) return null;

  return (
    <div className='absolute bottom-48 left-8 flex items-center gap-3 px-4 py-2.5 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl'>
      <div className='flex flex-col'>
        <span className='text-[10px] font-bold uppercase tracking-wider text-white/50'>
          {t(phase === 'work' ? 'pomodoro.work' : 'pomodoro.break')}
        </span>
        <span className='text-2xl font-bold font-variant-numeric leading-none text-white/90'>
          {formatRemaining(remainingMs)}
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
        className='p-2 rounded-full bg-white/5 hover:bg-white/20 transition-colors disabled:opacity-30'
        title={t('pomodoro.start')}
      >
        <Play className='w-4 h-4' />
      </button>
      <button
        onClick={reset}
        className='p-2 rounded-full bg-white/5 hover:bg-white/20 transition-colors'
        title={t('pomodoro.reset')}
      >
        <RotateCcw className='w-4 h-4' />
      </button>
    </div>
  );
};
