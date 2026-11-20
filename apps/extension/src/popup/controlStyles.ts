/**
 * The popup's shared control styles, in one module so a section cannot drift
 * into its own variant of a button or a hint.
 */

export const inputCls =
  'w-full min-w-0 px-3 py-2 rounded bg-black/40 border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm';
export const labelCls = 'text-xs font-semibold text-white/60 uppercase tracking-wider';
export const sectionCls = 'bg-white/5 border border-white/5 p-3 rounded-lg flex flex-col gap-2 min-w-0';

/** A small secondary action inside a section (Start, Reset, Export, Import). */
export const buttonCls =
  'px-3 py-1.5 rounded text-xs font-semibold transition-colors bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10';

/**
 * `accent-color` is all a native checkbox takes; `scheme-dark` draws the
 * unchecked box dark, as the rest of the popup is, instead of the light-scheme
 * white square.
 */
export const checkboxCls = 'accent-white/70 scheme-dark w-3.5 h-3.5 cursor-pointer shrink-0';

/** Explanatory text under a control. */
export const hintCls = 'text-2xs text-white/40';

/**
 * Something failed. One style everywhere, so an error never passes for a hint.
 * The element carries `role='alert'` unless the save status line already
 * announces the same message (`useSave().report`).
 */
export const errorCls = 'text-2xs text-red-300/80';
