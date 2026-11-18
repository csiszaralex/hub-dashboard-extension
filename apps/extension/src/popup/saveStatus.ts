import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveSettings, type HubSettings } from '../hooks/useSettings';
import { decodeSettings } from '../utils/settingsSchema';

/** How long "Saved" stays in the status line after a write Chrome accepted. */
const SAVED_VISIBLE_MS = 2000;

/** What the popup's status line says: nothing, a write that went through, or why one did not. */
export type SaveStatus = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string };

export interface SaveApi {
  /**
   * Writes settings the moment the user changes them, and reports the outcome
   * in the status line. Resolves `true` once Chrome accepted the write.
   */
  save: (patch: Partial<HubSettings>) => Promise<boolean>;
  /** Puts a failure that is not a write (a city not found, an image refused) in the status line. */
  report: (message: string) => void;
}

/**
 * Only the decoded fields reach storage: each value goes through the schema's
 * `decodeSettings`, the same decoders `useSettings` reads with, and a value
 * they would not accept drops out rather than being written and then read
 * back as its default.
 */
const writeDecoded = async (
  onSave: (settings: Partial<HubSettings>) => Promise<void>,
  patch: Partial<HubSettings>,
): Promise<boolean> => {
  const decoded = decodeSettings(patch);
  if (Object.keys(decoded).length === 0) return false;
  await onSave(decoded);
  return true;
};

/**
 * Outside the popup form (a section rendered on its own) there is no status
 * line, so this writes the same way and only logs a refusal.
 */
const standalone: SaveApi = {
  save: (patch) =>
    writeDecoded(saveSettings, patch).catch((error: unknown) => {
      console.error('Settings write failed:', error);
      return false;
    }),
  report: () => {},
};

export const SaveContext = createContext<SaveApi>(standalone);

export const useSave = (): SaveApi => useContext(SaveContext);

/**
 * The form's half: the `SaveApi` its sections write through, and the status the
 * status line shows.
 *
 * Only the latest outcome is shown. Writes finish in the order they were made,
 * but a numbered sequence makes that explicit rather than assumed, so an older
 * write resolving late cannot replace the outcome of a newer one.
 */
export const useSaveStatus = (onSave: (settings: Partial<HubSettings>) => Promise<void>) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const sequence = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const save = useCallback(
    async (patch: Partial<HubSettings>) => {
      const id = ++sequence.current;
      try {
        const wrote = await writeDecoded(onSave, patch);
        if (wrote && id === sequence.current) {
          clearTimeout(savedTimer.current);
          setStatus({ kind: 'saved' });
          savedTimer.current = setTimeout(
            () => setStatus((now) => (now.kind === 'saved' ? { kind: 'idle' } : now)),
            SAVED_VISIBLE_MS,
          );
        }
        return wrote;
      } catch (error) {
        // Chrome refuses the whole call (a quota, the write rate), so none of
        // the fields in it were kept, and the control already shows the new
        // value: the status line is the only place the user can learn that.
        if (id === sequence.current) {
          const message = error instanceof Error ? error.message : String(error);
          clearTimeout(savedTimer.current);
          setStatus({ kind: 'error', message: t('popup.saveFailed', { message }) });
        }
        return false;
      }
    },
    [onSave, t],
  );

  const report = useCallback((message: string) => {
    ++sequence.current;
    clearTimeout(savedTimer.current);
    setStatus({ kind: 'error', message });
  }, []);

  const api = useMemo<SaveApi>(() => ({ save, report }), [save, report]);
  return { status, api };
};
