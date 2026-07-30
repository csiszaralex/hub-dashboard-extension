import { describe, expect, it } from 'vitest';
import { WIDGET_IDS, isWidgetVisible, sanitizeHiddenWidgets } from './widgets';

describe('isWidgetVisible', () => {
  it('shows a widget that is not in the hidden list', () => {
    expect(isWidgetVisible(['weather'], 'clock')).toBe(true);
  });

  it('hides a widget that is in the hidden list', () => {
    expect(isWidgetVisible(['weather'], 'weather')).toBe(false);
  });

  it('shows everything when nothing is hidden', () => {
    expect(WIDGET_IDS.every((id) => isWidgetVisible([], id))).toBe(true);
  });
});

describe('sanitizeHiddenWidgets', () => {
  it('keeps known widget ids', () => {
    expect(sanitizeHiddenWidgets(['weather', 'note'])).toEqual(['weather', 'note']);
  });

  it('drops ids that no longer exist so a renamed widget cannot stay hidden forever', () => {
    expect(sanitizeHiddenWidgets(['weather', 'removed-widget'])).toEqual(['weather']);
  });

  it('returns an empty list for a non-array value', () => {
    expect(sanitizeHiddenWidgets('weather')).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(sanitizeHiddenWidgets(['note', 'note'])).toEqual(['note']);
  });
});
