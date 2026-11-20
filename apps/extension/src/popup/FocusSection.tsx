import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import { clampPomodoroMinutes, DEFAULT_BREAK_MINUTES, DEFAULT_WORK_MINUTES } from '../utils/pomodoro';
import { inputCls } from './controlStyles';
import { Field } from './Field';
import { PomodoroSession } from './PomodoroSession';
import { useDraftSetting } from './useDraftSetting';

/**
 * The Focus tab: the two phase lengths, and the running session.
 *
 * The lengths are held as the raw typed string, not a number: `Number('')` is
 * `0`, so a number-typed draft would redisplay `0` the instant the field is
 * cleared and turn a fresh `3` into `03`. They are clamped when written, and
 * passed to `clampPomodoroMinutes` as the string so it can tell an emptied
 * field (the default) from a deliberate `0` (the one-minute floor).
 */
export function FocusSection({ settings }: { settings: HubSettings }) {
  const { t } = useTranslation();
  const work = useDraftSetting(String(settings.pomodoroWorkMinutes), (value) => ({
    pomodoroWorkMinutes: clampPomodoroMinutes(value, DEFAULT_WORK_MINUTES),
  }));
  const rest = useDraftSetting(String(settings.pomodoroBreakMinutes), (value) => ({
    pomodoroBreakMinutes: clampPomodoroMinutes(value, DEFAULT_BREAK_MINUTES),
  }));

  return (
    <div className='flex flex-col gap-3'>
      <Field id='work' label={t('popup.pomodoroWork')}>
        <input
          id='work'
          type='number'
          min={1}
          max={180}
          value={work.draft}
          onChange={(e) => work.change(e.target.value)}
          onBlur={work.flush}
          className={inputCls}
        />
      </Field>
      <Field id='break' label={t('popup.pomodoroBreak')}>
        <input
          id='break'
          type='number'
          min={1}
          max={180}
          value={rest.draft}
          onChange={(e) => rest.change(e.target.value)}
          onBlur={rest.flush}
          className={inputCls}
        />
      </Field>
      {/*
        Last, and only on this tab: the two fields above configure the next
        session, this controls the one that may be running right now —
        including while the Focus widget is hidden, which is the only place the
        user could otherwise reach it from.
      */}
      <PomodoroSession />
    </div>
  );
}
