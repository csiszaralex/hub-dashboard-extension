import {
  Calendar,
  Cloud,
  Globe,
  Hourglass,
  Image,
  LayoutGrid,
  NotebookPen,
  Timer,
} from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { panelElementId, tabElementId } from './ariaIds';

export type TabId =
  | 'general'
  | 'appearance'
  | 'weather'
  | 'countdown'
  | 'pomodoro'
  | 'calendars'
  | 'widgets'
  | 'memos';

const TABS = [
  { id: 'general' as const, icon: Globe, labelKey: 'popup.tabGeneral' as const },
  { id: 'appearance' as const, icon: Image, labelKey: 'popup.tabAppearance' as const },
  { id: 'weather' as const, icon: Cloud, labelKey: 'popup.tabWeather' as const },
  { id: 'countdown' as const, icon: Timer, labelKey: 'popup.tabCountdown' as const },
  { id: 'pomodoro' as const, icon: Hourglass, labelKey: 'popup.tabPomodoro' as const },
  { id: 'calendars' as const, icon: Calendar, labelKey: 'popup.tabCalendars' as const },
  { id: 'widgets' as const, icon: LayoutGrid, labelKey: 'popup.tabWidgets' as const },
  { id: 'memos' as const, icon: NotebookPen, labelKey: 'popup.tabMemos' as const },
];

/** The keys that move along the strip, each mapped to the index it moves to. Both ends wrap. */
const STEP: Record<string, (index: number) => number> = {
  ArrowRight: (i) => (i + 1) % TABS.length,
  ArrowLeft: (i) => (i - 1 + TABS.length) % TABS.length,
  Home: () => 0,
  End: () => TABS.length - 1,
};

/**
 * The WAI-ARIA tabs pattern: one Tab stop for the whole strip (the active tab),
 * arrows to move between tabs, and selection following focus. The active tab
 * used to differ only in colour, which said nothing to a screen reader.
 */
export function TabNav({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  const { t } = useTranslation();
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const next = TABS[step(index)].id;
    onChange(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    // A grid, not a flex row: eight tabs across a 340px popup leave ~38px each,
    // and the buttons' default `min-width: auto` stops flex shrinking them below
    // their label, so the row overflowed and `overflow-hidden` silently clipped
    // the rightmost tabs — Widgets disappeared entirely when Focus was added.
    // Four columns wrap to 4+4 and give every label room to stay readable.
    //
    // `min-w-0` on each cell is what makes that permanent rather than lucky. A
    // grid item's `min-width: auto` also resolves to its min-content width, so
    // without the override the widest label still governs the column: at
    // `text-3xs` (9px) "BACKGROUND" is about 62px inside a ~69px cell, and a single
    // longer translation puts the row back over the edge and straight back
    // under this `overflow-hidden` — the exact failure that hid the Widgets tab,
    // and with it the whole widget-visibility feature, until a user reported it.
    // With the floor gone the 1fr tracks govern the width and a label that no
    // longer fits truncates inside its own cell instead of pushing the strip off
    // the end of the popup.
    <div
      role='tablist'
      aria-label={t('popup.tabsLabel')}
      className='grid grid-cols-4 rounded-lg overflow-hidden border border-white/10'
    >
      {TABS.map(({ id, icon: Icon, labelKey }, index) => (
        <button
          key={id}
          ref={(node) => {
            if (node) tabRefs.current.set(id, node);
            else tabRefs.current.delete(id);
          }}
          type='button'
          role='tab'
          id={tabElementId(id)}
          aria-selected={active === id}
          // Only the active tab's panel is mounted, and a reference to an id
          // that is not in the page is an invalid ARIA value.
          aria-controls={active === id ? panelElementId(id) : undefined}
          tabIndex={active === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={`flex flex-col items-center gap-1 py-2 px-1 min-w-0 transition-colors text-3xs font-semibold tracking-wide uppercase ${
            active === id
              ? 'bg-white/15 text-white'
              : 'text-white/35 hover:text-white/60 hover:bg-white/5'
          }`}
        >
          <Icon size={14} strokeWidth={active === id ? 2.5 : 1.75} />
          {/*
            Wrapped rather than left as a bare text node: `truncate` needs a
            block box of its own to ellipsise in, and `w-full` is what gives it
            one — `items-center` would otherwise shrink-wrap the span back to
            the label's full width and there would be nothing to truncate
            against.
          */}
          <span className='w-full truncate text-center'>{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
