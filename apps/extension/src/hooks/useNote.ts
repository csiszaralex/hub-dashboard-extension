import { useCallback, useEffect, useRef, useState } from 'react';

const NOTE_STORAGE_KEY = 'quick_note_content';

/** How long typing may pause before the note is written. */
const SAVE_DELAY_MS = 500;

const readNote = (): string => {
  try {
    return localStorage.getItem(NOTE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * `localStorage` can refuse a write (the origin's quota, or storage blocked).
 * The text is still on screen and in state, so the next write tries again.
 */
const writeNote = (note: string) => {
  try {
    localStorage.setItem(NOTE_STORAGE_KEY, note);
  } catch (error) {
    console.error('Quick note could not be saved:', error);
  }
};

/**
 * The quick note, kept in `localStorage`.
 *
 * Writes are debounced while typing, but a pending write is never dropped: it
 * is flushed when the component unmounts and when the page is hidden or
 * closed (`pagehide`), which is what closing a new tab right after typing
 * does. Other tabs follow through the `storage` event, so an edit made in one
 * open tab is not overwritten by a stale copy from another.
 */
export const useNote = () => {
  const [note, setNoteState] = useState(readNote);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current !== null) {
      writeNote(pending.current);
      pending.current = null;
    }
  }, []);

  const setNote = useCallback(
    (value: string) => {
      setNoteState(value);
      pending.current = value;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // Fired only in the other tabs, never in the one that wrote. A tab with
      // unsaved typing of its own keeps it: that typing is the newer edit.
      if (event.key !== NOTE_STORAGE_KEY || pending.current !== null) return;
      setNoteState(event.newValue ?? '');
    };

    window.addEventListener('pagehide', flush);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('storage', onStorage);
      flush();
    };
  }, [flush]);

  return { note, setNote };
};
