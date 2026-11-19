import { useCallback, useEffect, useRef, useState } from 'react';
import { UNDO_WINDOW_MS } from '../utils/undo';

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

  const save = useCallback(
    (value: string) => {
      setNoteState(value);
      pending.current = value;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  // The text a clear removed, while Undo is on offer for it.
  const [cleared, setCleared] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dropUndo = useCallback(() => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setCleared(null);
  }, []);

  /**
   * A keystroke also withdraws a pending Undo: restoring the cleared text
   * over something typed since would throw the newer text away.
   */
  const setNote = useCallback(
    (value: string) => {
      dropUndo();
      save(value);
    },
    [dropUndo, save],
  );

  /**
   * Clears the note, and keeps what it said for `UNDO_WINDOW_MS`.
   *
   * The empty note is saved the ordinary way, not held back until the undo
   * runs out: closing the tab inside the window must leave it cleared, as the
   * click asked, and other tabs follow the clear as they follow any edit.
   */
  const clearNote = useCallback(() => {
    if (!note) return;
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    setCleared(note);
    undoTimer.current = setTimeout(dropUndo, UNDO_WINDOW_MS);
    save('');
  }, [dropUndo, note, save]);

  /** Puts the cleared text back, and saves it like any edit. */
  const undoClear = useCallback(() => {
    if (cleared === null) return;
    dropUndo();
    save(cleared);
  }, [cleared, dropUndo, save]);

  useEffect(
    () => () => {
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    },
    [],
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // Fired only in the other tabs, never in the one that wrote. A tab with
      // unsaved typing of its own keeps it: that typing is the newer edit.
      if (event.key !== NOTE_STORAGE_KEY || pending.current !== null) return;
      // Another tab's edit is newer than the text an Undo here would restore.
      dropUndo();
      setNoteState(event.newValue ?? '');
    };

    window.addEventListener('pagehide', flush);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('storage', onStorage);
      flush();
    };
  }, [dropUndo, flush]);

  return {
    note,
    setNote,
    clearNote,
    undoClear,
    /** True while the last clear can still be undone. */
    canUndoClear: cleared !== null,
  };
};
