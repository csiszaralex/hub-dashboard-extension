import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { TabId } from './TabNav';

// Hoisted out of the JSX, the same way PopupForm.test.tsx builds its settings
// objects: i18next/no-literal-string flags string literals inside JSX attribute
// expressions too, not just rendered text.
const ACTIVE = 'general' as const;

/**
 * `TabNav` is the only thing under test here, so nothing else in the import
 * graph installs the react-i18next binding — without this the labels render
 * as their raw keys and every name lookup below misses.
 */
const load = async () => {
  await import('../i18n/i18n');
  return (await import('./TabNav')).TabNav;
};

/** `TabNav` is controlled; this holds the selection the way `PopupForm` does. */
const renderStateful = async (initial: TabId) => {
  const TabNav = await load();
  const Harness = () => {
    const [active, setActive] = useState<TabId>(initial);
    return <TabNav active={active} onChange={setActive} />;
  };
  render(<Harness />);
};

const selected = () =>
  screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true');

/**
 * happy-dom has no layout engine, so nothing here can measure a clipped tab.
 * The classes are the invariant instead: the tab strip was clipped once
 * already — Widgets, and with it the whole widget-visibility feature, was
 * invisible until a user reported it — and the fix is two utility classes that
 * are trivially easy to drop in a later restyle.
 */
describe('TabNav', () => {
  it('renders one tab per settings section', async () => {
    const TabNav = await load();

    render(<TabNav active={ACTIVE} onChange={() => {}} />);

    expect(screen.getAllByRole('tab')).toHaveLength(8);
    expect(screen.queryByRole('tab', { name: 'Widgets' })).not.toBeNull();
    expect(screen.queryByRole('tab', { name: 'Memos' })).not.toBeNull();
  });

  it('lets every tab shrink below its label instead of widening the strip', async () => {
    const TabNav = await load();

    render(<TabNav active={ACTIVE} onChange={() => {}} />);

    for (const tab of screen.getAllByRole('tab')) {
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

describe('TabNav — the tabs pattern', () => {
  it('names the strip and marks the active tab selected, not only coloured', async () => {
    const TabNav = await load();

    render(<TabNav active={ACTIVE} onChange={() => {}} />);

    expect(screen.getByRole('tablist', { name: 'Settings sections' })).not.toBeNull();
    expect(selected().map((tab) => tab.textContent)).toEqual(['General']);
  });

  it('is one Tab stop: only the active tab is in the Tab order', async () => {
    const TabNav = await load();

    render(<TabNav active={ACTIVE} onChange={() => {}} />);

    const inOrder = screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0);
    expect(inOrder.map((tab) => tab.textContent)).toEqual(['General']);
  });

  it('moves the selection and focus with the arrow keys, wrapping at the ends', async () => {
    await renderStateful(ACTIVE);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'General' }), { key: 'ArrowRight' });
    expect(selected().map((tab) => tab.textContent)).toEqual(['Background']);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Background' }));

    // Left from the first tab lands on the last, as the pattern specifies.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Background' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'General' }), { key: 'ArrowLeft' });
    expect(selected().map((tab) => tab.textContent)).toEqual(['Memos']);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Memos' }));

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Memos' }), { key: 'Home' });
    expect(selected().map((tab) => tab.textContent)).toEqual(['General']);
  });
});
