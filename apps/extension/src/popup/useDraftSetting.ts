import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubSettings } from '../hooks/useSettings';
import { useSave } from './saveStatus';

/**
 * How long a typing pause lasts before a free-text field is written.
 *
 * `chrome.storage.sync` caps writes: `MAX_WRITE_OPERATIONS_PER_MINUTE` is 120
 * and `MAX_WRITE_OPERATIONS_PER_HOUR` is 1800, "the maximum number of `set`,
 * `remove`, or `clear` operations that can be performed each minute / hour",
 * and "updates that would cause this limit to be exceeded fail immediately"
 * (developer.chrome.com/docs/extensions/reference/api/storage). A write per
 * keystroke would reach the per-minute cap within a minute of steady typing.
 * One write per pause means at least this long between writes, so at most 100
 * a minute; the hourly cap averages 30 a minute and would take a long session
 * of pausing after nearly every word. A refusal still lands in the status line
 * like any other failed write.
 */
export const DRAFT_SAVE_DELAY_MS = 600;

/**
 * A free-text setting: the field's text as typed, written after a pause, on
 * blur, and when the popup is hidden or the field unmounts.
 *
 * Hidden and unmount matter as much as the pause. A Chrome popup closes on any
 * click outside it, and a tab switch unmounts the field, so either can follow
 * a keystroke by less than the delay; both flush the pending text instead of
 * dropping it. The flush calls `storage.sync.set` synchronously inside the
 * event, before the page is torn down.
 *
 * `toPatch` turns the text into the settings to write — trimming, parsing,
 * clamping — and the save path decodes the result once more before it reaches
 * storage.
 */
export const useDraftSetting = <T>(initial: T, toPatch: (draft: T) => Partial<HubSettings>) => {
  const { save } = useSave();
  const [draft, setDraft] = useState(initial);
  /** The text not yet written, or null when storage already has it. */
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The latest callbacks, so `flush` can stay stable across renders. */
  const latest = useRef({ save, toPatch });
  useEffect(() => {
    latest.current = { save, toPatch };
  });

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const unsaved = pending.current;
    if (!unsaved) return;
    pending.current = null;
    void latest.current.save(latest.current.toPatch(unsaved.value));
  }, []);

  const change = useCallback(
    (value: T) => {
      setDraft(value);
      pending.current = { value };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DRAFT_SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  return { draft, change, flush };
};
