import { useSyncExternalStore } from 'react';
import {
  applyStoredSettings,
  DEFAULT_SETTINGS,
  migrateStoredSettings,
  migrationWrites,
  readSettings,
  SETTING_KEYS,
  type HubSettings,
  type MigrationResult,
  type StoredSettings,
} from '../utils/settingsSchema';

// Re-exported so the many `import type { HubSettings } from '…/useSettings'`
// keep working; the declaration lives in `utils/settingsSchema`.
export type { HubSettings } from '../utils/settingsSchema';

interface SettingsState {
  settings: HubSettings;
  isLoaded: boolean;
  /**
   * Whether `chrome.storage.sync` held any setting when this page first read
   * it: the sign that the extension was used before, on this machine or on
   * another one the account syncs with. Fixed at that first read, so a setting
   * saved while the page is open does not change what the page decided at
   * load. `settingsVersion` does not count: `writeMigration` records it on the
   * very first page of a fresh install, so it proves nothing about earlier use.
   */
  hadStoredSettings: boolean;
}

/**
 * Settings live in one module-level store rather than in per-hook state.
 *
 * Every widget needs them, and a `useState` + listener pair per consumer meant
 * one `chrome.storage.sync.get` and one `onChanged` listener per widget, each
 * resolving at its own time — so widgets flickered in independently.
 *
 * Both the first read and every later change go through the schema's read
 * policy (`applyStoredSettings`): an invalid stored value reaches the widgets
 * as its default, never as stored.
 */
let state: SettingsState = {
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  hadStoredSettings: false,
};
const listeners = new Set<() => void>();
let started = false;

const emit = () => listeners.forEach((listener) => listener());

const applyChanges = (changes: Record<string, chrome.storage.StorageChange>) => {
  // A removed key arrives with no `newValue`, which the read policy turns into
  // the default, as it does for any other value that is not a setting.
  const stored: StoredSettings = {};
  for (const key of SETTING_KEYS) {
    if (key in changes) stored[key] = changes[key].newValue;
  }
  // `settingsVersion` and other non-settings keys change nothing on the page.
  if (Object.keys(stored).length === 0) return;

  state = { ...state, settings: applyStoredSettings(state.settings, stored) };
  emit();
};

/**
 * Records the migrated settings and the version. Best effort: a refused write
 * leaves storage as it was, so the same migration simply runs on the next page,
 * and this page already renders the migrated values.
 */
const writeMigration = (before: StoredSettings, migrated: MigrationResult) => {
  const writes = migrationWrites(before, migrated);
  if (!writes) return;
  chrome.storage.sync.set(writes.set, () => {
    if (chrome.runtime.lastError || writes.remove.length === 0) return;
    chrome.storage.sync.remove(writes.remove);
  });
};

const start = () => {
  if (started) return;
  started = true;

  // Everything, not only the current keys: a migration may need a key that is
  // no longer a setting, such as the old name of a renamed one.
  chrome.storage.sync.get(null, (stored: StoredSettings) => {
    const migrated = migrateStoredSettings(stored);
    state = {
      settings: readSettings(migrated.stored),
      isLoaded: true,
      hadStoredSettings: SETTING_KEYS.some((key) => key in migrated.stored),
    };
    emit();
    writeMigration(stored, migrated);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') applyChanges(changes);
  });
};

const subscribe = (listener: () => void) => {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;

/**
 * Writes settings to `chrome.storage.sync`, rejecting with Chrome's message
 * when the write is refused.
 *
 * Refusal is not hypothetical: sync storage has a per-item and a total quota,
 * and Chrome rejects the whole call when one item is over, so none of the
 * settings in it are written. Callers must handle the rejection, because the
 * page has already shown the values as if they were saved.
 */
export const saveSettings = (newSettings: Partial<HubSettings>): Promise<void> =>
  new Promise((resolve, reject) => {
    chrome.storage.sync.set(newSettings, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });

export const useSettings = () => {
  const { settings, isLoaded, hadStoredSettings } = useSyncExternalStore(subscribe, getSnapshot);
  return { settings, isLoaded, hadStoredSettings, saveSettings };
};
