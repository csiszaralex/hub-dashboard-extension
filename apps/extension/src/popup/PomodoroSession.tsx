import { useTranslation } from 'react-i18next';
import { usePomodoro } from '../hooks/usePomodoro';
import { formatRemaining } from '../utils/pomodoro';
import { Field } from './Field';

const buttonCls =
  'px-3 py-1.5 rounded text-xs font-semibold transition-colors bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10';

/**
 * Start and Reset for the session the service worker owns.
 *
 * These used to exist only on `PomodoroWidget`, which was fine for exactly as
 * long as the timer lived in the widget: hiding Focus from the Widgets tab
 * unmounted the controls and the timer together. Moving the timer into the
 * service worker separated the two, and hiding the widget mid-session then left
 * a timer running with no Start and no Reset anywhere in the extension — phase
 * notifications every few minutes until the browser was restarted.
 *
 * The fix is these controls, not cancelling the session when the widget goes
 * away: a timer running on notifications alone, with no dashboard open, is a
 * real use the worker move made possible and worth keeping. So the controls
 * follow the timer to the one surface that is always reachable.
 *
 * `usePomodoro` is the widget's hook, used here unchanged. It needs
 * `chrome.storage.local` and `chrome.runtime.sendMessage`, both of which an
 * extension popup has, and it owns no page-only state — the popup is just
 * another reader of the same worker-owned session.
 *
 * Rendered only while the Focus tab is open, so a popup opened on any other tab
 * registers no storage listener, wakes no worker and runs no display interval.
 */
export function PomodoroSession() {
  const { phase, running, remainingMs, ready, start, reset } = usePomodoro();
  const { t } = useTranslation();

  return (
    <Field label={t('popup.pomodoroSession')} hint={t('popup.pomodoroSessionHint')}>
      <div className='flex items-center justify-between gap-3 min-w-0'>
        <div className='flex items-baseline gap-2 min-w-0'>
          <span className='text-xl font-semibold tabular-nums'>{formatRemaining(remainingMs)}</span>
          {/*
            The same two words the widget shows, from the same keys: idle
            reports the phase that is next up, which is always Focus, so there
            is no third "stopped" vocabulary to learn.
          */}
          <span className='text-[10px] uppercase tracking-wider text-white/50 truncate'>
            {t(phase === 'work' ? 'pomodoro.work' : 'pomodoro.break')}
          </span>
        </div>
        {/*
          `type='button'` on both, and not by habit: a <button> inside a <form>
          defaults to `type="submit"`, so a click on either of these would run
          the popup's save handler and write every pending field on the form as
          a side effect of pressing Start.

          They also do not route through that handler on purpose. Start and
          Reset are commands — they post their message to the worker the moment
          they are pressed, unlike the two length fields above them, which are
          settings and wait for "Apply settings" like everything else.
        */}
        <div className='flex gap-2 shrink-0'>
          {/*
            Start is disabled until the stored session has been read, for the
            reason the widget renders nothing at all until then: before it
            arrives a running session still looks idle, and Start on a running
            session restarts it at a fresh Focus phase. Blanking the controls
            for that one microtask would make them flicker under the cursor,
            so the popup keeps them in place and disabled instead.
          */}
          <button type='button' onClick={start} disabled={running || !ready} className={buttonCls}>
            {t('pomodoro.start')}
          </button>
          <button type='button' onClick={reset} className={buttonCls}>
            {t('pomodoro.reset')}
          </button>
        </div>
      </div>
    </Field>
  );
}
