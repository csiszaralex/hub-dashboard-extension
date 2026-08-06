export type PomodoroPhase = 'work' | 'break';

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;
export const DEFAULT_WORK_MINUTES = 25;
export const DEFAULT_BREAK_MINUTES = 5;

export const nextPhase = (phase: PomodoroPhase): PomodoroPhase =>
  phase === 'work' ? 'break' : 'work';

/** Clamped so a corrupt or hand-edited setting cannot produce a zero-length timer. */
export const phaseDurationMs = (
  phase: PomodoroPhase,
  workMinutes: number,
  breakMinutes: number,
): number => {
  const raw = phase === 'work' ? workMinutes : breakMinutes;
  // `|| MIN_MINUTES` exists for `Math.round(raw)` coming back `NaN` (a corrupt
  // synced value): `Math.max` propagates `NaN` through unchanged rather than
  // ignoring it, so without this fallback a corrupt value would produce a
  // `NaN`-length phase instead of the one-minute floor the clamp promises.
  const minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(raw) || MIN_MINUTES));
  return minutes * 60 * 1000;
};

/**
 * Same clamp `phaseDurationMs` applies internally, exposed so a length can be
 * normalised once at the point it is stored (settings merge, live storage
 * change, and the popup's save) instead of only at the point it is consumed.
 * `fallback` is used only when `value` is not a finite number at all (e.g.
 * `NaN` from a hand-edited sync value) — an in-range or out-of-range number
 * is rounded and clamped, not replaced.
 */
export const clampPomodoroMinutes = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n)));
};

export const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
