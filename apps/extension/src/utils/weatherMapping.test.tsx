import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

// Imported per test: the module pulls in i18n, which reads `chrome` when it
// loads, and `src/test/setup.ts` installs the stub before each test.
let getWeatherIcon: typeof import('./weatherMapping').getWeatherIcon;
beforeEach(async () => {
  ({ getWeatherIcon } = await import('./weatherMapping'));
});

/** The lucide component a code maps to, by its display name. */
const iconOf = (code: number, isDaytime = true): string => {
  const node = getWeatherIcon(code, isDaytime);
  if (!isValidElement(node)) throw new Error(`No element for code ${code}`);
  const type = (node as ReactElement).type as { displayName?: string };
  return type.displayName ?? '';
};

// WMO weather interpretation codes, as Open-Meteo documents them.
describe('getWeatherIcon', () => {
  it.each([
    [0, 'Sun'],
    [1, 'CloudSun'],
    [2, 'CloudSun'],
    [3, 'Cloud'],
    [45, 'CloudFog'],
    [48, 'CloudFog'],
    [51, 'CloudDrizzle'],
    [55, 'CloudDrizzle'],
    [56, 'CloudDrizzle'],
    [57, 'CloudDrizzle'],
    [61, 'CloudRain'],
    [65, 'CloudRain'],
    [66, 'CloudRain'],
    [67, 'CloudRain'],
    [71, 'CloudSnow'],
    [73, 'CloudSnow'],
    [75, 'CloudSnow'],
    [77, 'CloudSnow'],
    [80, 'CloudRain'],
    [82, 'CloudRain'],
    [85, 'CloudSnow'],
    [86, 'CloudSnow'],
    [95, 'CloudLightning'],
    [99, 'CloudLightning'],
  ])('maps code %i to %s', (code, icon) => {
    expect(iconOf(code)).toBe(icon);
  });

  it('uses the night variants after dark', () => {
    expect(iconOf(0, false)).toBe('Moon');
    expect(iconOf(2, false)).toBe('CloudMoon');
  });
});
