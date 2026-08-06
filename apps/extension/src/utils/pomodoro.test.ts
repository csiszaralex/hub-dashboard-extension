import { describe, expect, it } from 'vitest';
import { clampPomodoroMinutes, formatRemaining, MAX_MINUTES, MIN_MINUTES, nextPhase, phaseDurationMs } from './pomodoro';

describe('nextPhase', () => {
  it('follows work with a break', () => {
    expect(nextPhase('work')).toBe('break');
  });

  it('follows a break with work', () => {
    expect(nextPhase('break')).toBe('work');
  });
});

describe('phaseDurationMs', () => {
  it('uses the configured work length', () => {
    expect(phaseDurationMs('work', 25, 5)).toBe(25 * 60 * 1000);
  });

  it('uses the configured break length', () => {
    expect(phaseDurationMs('break', 25, 5)).toBe(5 * 60 * 1000);
  });

  it('refuses a non-positive length and falls back to one minute', () => {
    expect(phaseDurationMs('work', 0, 5)).toBe(60 * 1000);
  });

  it('caps an absurd length at three hours', () => {
    expect(phaseDurationMs('work', 600, 5)).toBe(180 * 60 * 1000);
  });

  // `Math.max(MIN_MINUTES, Math.round(0))` already floors a merely non-positive
  // length to one minute on its own, so the "refuses a non-positive length"
  // test above passes even without the `|| MIN_MINUTES` fallback. Only a
  // value that is not a number at all (NaN propagates through `Math.max`
  // unchanged) exercises that fallback — this is the corrupt-synced-value
  // case the function's doc comment cites.
  it('falls back to one minute for a value that is not a number at all, e.g. a corrupt synced value', () => {
    expect(phaseDurationMs('work', Number.NaN, 5)).toBe(60 * 1000);
  });
});

describe('clampPomodoroMinutes', () => {
  it('keeps an in-range value unchanged', () => {
    expect(clampPomodoroMinutes(25, 25)).toBe(25);
  });

  it('rounds a fractional value', () => {
    expect(clampPomodoroMinutes(24.6, 25)).toBe(25);
  });

  it('clamps a non-positive value up to the minimum', () => {
    expect(clampPomodoroMinutes(0, 25)).toBe(MIN_MINUTES);
  });

  it('clamps an absurd value down to the maximum', () => {
    expect(clampPomodoroMinutes(600, 25)).toBe(MAX_MINUTES);
  });

  it('falls back to the given default for a non-numeric value', () => {
    expect(clampPomodoroMinutes('nonsense', 25)).toBe(25);
  });

  it('falls back to the given default for NaN', () => {
    expect(clampPomodoroMinutes(Number.NaN, 25)).toBe(25);
  });

  // `Number('')` is `0`, not `NaN`, so an emptied input field would otherwise
  // sail past the `Number.isFinite` guard and clamp up to the minimum instead
  // of falling back — "nothing was entered" must be treated as "no value",
  // distinct from a deliberate `0`.
  it('falls back to the given default for an empty string', () => {
    expect(clampPomodoroMinutes('', 25)).toBe(25);
  });

  it('falls back to the given default for a whitespace-only string', () => {
    expect(clampPomodoroMinutes('   ', 25)).toBe(25);
  });

  // A user who deliberately types 0 is saying "as short as possible"; that
  // must still clamp up to the minimum rather than collapse into the
  // empty-string fallback behaviour above.
  it('still clamps an explicit 0 up to the minimum rather than falling back', () => {
    expect(clampPomodoroMinutes(0, 25)).toBe(MIN_MINUTES);
    expect(clampPomodoroMinutes('0', 25)).toBe(MIN_MINUTES);
  });
});

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(formatRemaining(9 * 60 * 1000 + 5000)).toBe('09:05');
  });

  it('formats a value above an hour without dropping the minutes', () => {
    expect(formatRemaining(65 * 60 * 1000)).toBe('65:00');
  });

  it('never formats below zero', () => {
    expect(formatRemaining(-1000)).toBe('00:00');
  });
});
