/**
 * Makes the document report a visibility state and announces the change, as a
 * browser does when the user switches tabs. happy-dom always says `visible`
 * and never fires the event on its own.
 */
export const setPageVisibility = (state: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

/** Drops the override, so the next test sees the document's own `visibilityState`. */
export const restorePageVisibility = (): void => {
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
};
