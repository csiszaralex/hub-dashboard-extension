import type { TabId } from './TabNav';

/**
 * Element ids that tie one popup element to another through ARIA, so both
 * sides read the same spelling. Outside the component files because
 * react-refresh only hot-reloads a file whose exports are all components.
 */

/**
 * A `Field`'s hint, for its control's `aria-describedby`. Only the control can
 * carry the reference, and the control is the caller's child of `Field`.
 */
export const hintId = (id: string) => `${id}-hint`;

/** A `TabNav` tab, which labels its panel. */
export const tabElementId = (tab: TabId) => `popup-tab-${tab}`;

/** The panel `PopupForm` renders for a tab, which the tab controls. */
export const panelElementId = (tab: TabId) => `popup-panel-${tab}`;
