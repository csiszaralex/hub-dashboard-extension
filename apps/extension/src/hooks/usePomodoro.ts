import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from '../i18n/i18n';
import { nextPhase, phaseDurationMs, type PomodoroPhase } from '../utils/pomodoro';
import { useSettings } from './useSettings';

const TICK_MS = 1000;

const notify = (phase: PomodoroPhase) => {
  // `notifications` is declared in manifest.json, so this API is present in
  // every real extension context — but a hook this stateful is worth guarding
  // defensively anyway rather than letting a phase transition throw and take
  // the ticking interval down with it.
  if (typeof chrome === 'undefined' || !chrome.notifications) return;

  chrome.notifications.create(`hub-pomodoro-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: i18n.t('pomodoro.notificationTitle'),
    message: i18n.t(phase === 'break' ? 'pomodoro.breakStarted' : 'pomodoro.workStarted'),
  });
};

export const usePomodoro = () => {
  const { settings, isLoaded } = useSettings();
  const [phase, setPhase] = useState<PomodoroPhase>('work');
  const [running, setRunning] = useState(false);
  // Only ticks while running; the idle display below is derived straight from
  // `phase` + settings during render instead of mirrored into state via an
  // effect, which both avoids a redundant render and keeps
  // `react-hooks/set-state-in-effect` happy — that rule flags exactly this
  // "copy a value into state so it can be read" shape.
  const [tickRemainingMs, setTickRemainingMs] = useState(0);
  const phaseRef = useRef<PomodoroPhase>('work');
  // `endsAt` lives in a ref rather than state: `tick` mutates it in place on a
  // phase transition so the *next* call of the same `setInterval` closure
  // (which can fire again before React re-renders and re-subscribes, e.g. when
  // fake timers fast-forward past a whole minute in one synchronous burst)
  // reads the fresh deadline instead of the one captured when the interval was
  // set up. With `endsAt` as state that stale read made a transition fire
  // twice for one elapsed minute.
  const endsAtRef = useRef<number | null>(null);

  const durationFor = useCallback(
    (p: PomodoroPhase) =>
      phaseDurationMs(p, settings.pomodoroWorkMinutes, settings.pomodoroBreakMinutes),
    [settings.pomodoroBreakMinutes, settings.pomodoroWorkMinutes],
  );

  const remainingMs = running ? tickRemainingMs : durationFor(phase);

  const start = useCallback(() => {
    phaseRef.current = phase;
    endsAtRef.current = Date.now() + durationFor(phase);
    setTickRemainingMs(durationFor(phase));
    setRunning(true);
  }, [durationFor, phase]);

  const reset = useCallback(() => {
    setRunning(false);
    endsAtRef.current = null;
    setPhase('work');
    phaseRef.current = 'work';
  }, []);

  useEffect(() => {
    if (!running) return;

    const tick = () => {
      if (endsAtRef.current === null) return;
      const left = endsAtRef.current - Date.now();
      if (left > 0) {
        setTickRemainingMs(left);
        return;
      }

      // Phase elapsed: announce it and roll straight into the next one.
      const upcoming = nextPhase(phaseRef.current);
      phaseRef.current = upcoming;
      endsAtRef.current = Date.now() + durationFor(upcoming);
      notify(upcoming);
      setPhase(upcoming);
      setTickRemainingMs(durationFor(upcoming));
    };

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [durationFor, running]);

  return { phase, running, remainingMs, ready: isLoaded, start, reset };
};
