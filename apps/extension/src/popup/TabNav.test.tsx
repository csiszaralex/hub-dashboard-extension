import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Hoisted out of the JSX, the same way PopupForm.test.tsx builds its settings
// objects: i18next/no-literal-string flags string literals inside JSX attribute
// expressions too, not just rendered text. Which tab is active is irrelevant to
// both assertions below — every tab gets the same classes.
const ACTIVE = 'general' as const;

/**
 * happy-dom has no layout engine, so nothing here can measure a clipped tab.
 * The classes are the invariant instead: the tab strip was clipped once
 * already — Widgets, and with it the whole widget-visibility feature, was
 * invisible until a user reported it — and the fix is two utility classes that
 * are trivially easy to drop in a later restyle.
 */
describe('TabNav', () => {
  it('renders one button per settings tab', async () => {
    // `TabNav` is the only thing under test here, so nothing else in the import
    // graph installs the react-i18next binding — without this the labels render
    // as their raw keys and every name lookup below misses.
    await import('../i18n/i18n');
    const { TabNav } = await import('./TabNav');

    render(<TabNav active={ACTIVE} onChange={() => {}} />);

    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.queryByRole('button', { name: 'Widgets' })).not.toBeNull();
  });

  it('lets every tab shrink below its label instead of widening the strip', async () => {
    // `TabNav` is the only thing under test here, so nothing else in the import
    // graph installs the react-i18next binding — without this the labels render
    // as their raw keys and every name lookup below misses.
    await import('../i18n/i18n');
    const { TabNav } = await import('./TabNav');

    render(<TabNav active={ACTIVE} onChange={() => {}} />);

    for (const tab of screen.getAllByRole('button')) {
      // Without this the grid item's `min-width: auto` resolves to the label's
      // min-content width, so one longer localized label widens the row past
      // the popup and the nav's `overflow-hidden` swallows the rightmost tabs.
      expect(tab.className).toContain('min-w-0');
      // And with the floor gone, the label has to degrade inside its own cell
      // rather than spill out of it.
      expect(tab.querySelector('span')?.className).toContain('truncate');
    }
  });
});
