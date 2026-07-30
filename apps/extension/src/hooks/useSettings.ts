import { useSyncExternalStore } from 'react';
import { DEFAULT_DIM } from '../utils/dim';

export interface HubSettings {
  unsplashQuery: string;
  backgroundDim: number;
  locationCity: string;
  locationLat: number | null;
  locationLon: number | null;
  selectedCalendars: string[];
  countdownTarget: string | null;
  language: string;
}

const DEFAULT_SETTINGS: HubSettings = {
  unsplashQuery: 'landscape,forest,mountain,fog,nature view',
  backgroundDim: DEFAULT_DIM,
  locationCity: '',
  locationLat: null,
  locationLon: null,
  selectedCalendars: ['primary'],
  countdownTarget: null,
  language: '',
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof HubSettings)[];

interface SettingsState {
  settings: HubSettings;
  isLoaded: boolean;
}

/**
 * Settings live in one module-level store rather than in per-hook state.
 *
 * Every widget needs them, and a `useState` + listener pair per consumer meant
 * one `chrome.storage.sync.get` and one `onChanged` listener per widget, each
 * resolving at its own time — so widgets flickered in independently.
 */
let state: SettingsState = { settings: DEFAULT_SETTINGS, isLoaded: false };
const listeners = new Set<() => void>();
let started = false;

const emit = () => listeners.forEach((listener) => listener());

const merge = (stored: Partial<HubSettings>): HubSettings => {
  const next = { ...DEFAULT_SETTINGS };
  for (const key of KEYS) {
    const value = stored[key];
    if (value !== undefined && value !== null) {
      // Each key keeps its own type; the cast is contained to this assignment.
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
};

const applyChanges = (changes: Record<string, chrome.storage.StorageChange>) => {
  const next = { ...state.settings };
  let changed = false;

  for (const key of KEYS) {
    if (!(key in changes)) continue;
    const value = changes[key].newValue;
    (next as Record<string, unknown>)[key] = value ?? DEFAULT_SETTINGS[key];
    changed = true;
  }

  if (!changed) return;
  state = { settings: next, isLoaded: state.isLoaded };
  emit();
};

const start = () => {
  if (started) return;
  started = true;

  chrome.storage.sync.get(KEYS, (stored) => {
    state = { settings: merge(stored as Partial<HubSettings>), isLoaded: true };
    emit();
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

export const saveSettings = (newSettings: Partial<HubSettings>) => {
  chrome.storage.sync.set(newSettings);
};

export const useSettings = () => {
  const { settings, isLoaded } = useSyncExternalStore(subscribe, getSnapshot);
  return { settings, isLoaded, saveSettings };
};
