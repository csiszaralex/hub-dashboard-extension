import { useCallback, useEffect, useState } from 'react';

/**
 * Focus lives in a field where "." is literal text, not a shortcut.
 *
 * Checks `document.activeElement` rather than `event.target`: a native
 * keydown bubbling up to a `window` listener has its target set to the
 * originally focused element anyway, so this matches real usage — but it
 * also holds for listeners attached directly to `window`, whose synthetic
 * or programmatically dispatched events report `window` itself as the target.
 */
const isTyping = (): boolean => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return (
    active.isContentEditable ||
    active.tagName === 'INPUT' ||
    active.tagName === 'TEXTAREA' ||
    active.tagName === 'SELECT'
  );
};

/**
 * Shows and hides the dashboard overlay.
 *
 * Double-click still works, but it is undiscoverable and unreachable from a
 * keyboard, so "." toggles and Escape always restores — a user who hid the UI
 * by accident needs one guaranteed way back.
 */
export const useUiVisibility = () => {
  const [uiVisible, setUiVisible] = useState(true);

  const toggle = useCallback(() => setUiVisible((v) => !v), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A held modifier hands this key to the OS or browser instead — that
      // includes Cmd/Ctrl+Esc, which must stay a system shortcut and must
      // NOT restore the UI. Checked before the key branches below, so it
      // applies to both "." and Escape alike.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping()) return;

      if (event.key === '.') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'Escape') {
        setUiVisible(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return { uiVisible, toggle };
};
