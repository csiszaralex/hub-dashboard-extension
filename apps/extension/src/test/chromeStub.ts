type StorageChange = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, StorageChange>, area: string) => void;

export interface ChromeStub {
  /** Seed sync storage before the code under test reads it. */
  seedSync: (values: Record<string, unknown>) => void;
  /** Number of `storage.sync.get` calls — used to assert we read settings once, not once per hook. */
  syncGetCount: () => number;
  /** Number of registered `storage.onChanged` listeners. */
  changeListenerCount: () => number;
  /** Token handed back by `identity.getAuthToken`; `null` simulates a signed-out user. */
  setAuthToken: (token: string | null) => void;
}

/**
 * Installs a fake `chrome` global backed by an in-memory store.
 *
 * `storage.sync.get` resolves on a microtask like the real API does, so tests
 * exercise the same "settings arrive after first render" ordering as Chrome.
 */
export const installChromeStub = (): ChromeStub => {
  const store = new Map<string, unknown>();
  const listeners = new Set<ChangeListener>();
  let getCount = 0;
  let authToken: string | null = null;

  const chromeStub = {
    storage: {
      sync: {
        get: (keys: string[] | string, cb: (items: Record<string, unknown>) => void) => {
          getCount++;
          const wanted = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of wanted) {
            if (store.has(key)) result[key] = store.get(key);
          }
          queueMicrotask(() => cb(result));
        },
        set: (items: Record<string, unknown>, cb?: () => void) => {
          const changes: Record<string, StorageChange> = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: store.get(key), newValue: value };
            store.set(key, value);
          }
          queueMicrotask(() => {
            listeners.forEach((l) => l(changes, 'sync'));
            cb?.();
          });
        },
      },
      local: {
        get: (_keys: string[] | string, cb: (items: Record<string, unknown>) => void) =>
          queueMicrotask(() => cb({})),
        set: (_items: Record<string, unknown>, cb?: () => void) => queueMicrotask(() => cb?.()),
      },
      onChanged: {
        addListener: (l: ChangeListener) => listeners.add(l),
        removeListener: (l: ChangeListener) => listeners.delete(l),
      },
    },
    identity: {
      getAuthToken: (_options: { interactive: boolean }, cb: (token: string) => void) =>
        queueMicrotask(() => cb(authToken as string)),
    },
    runtime: {
      lastError: undefined as { message: string } | undefined,
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

  return {
    seedSync: (values) => {
      for (const [key, value] of Object.entries(values)) store.set(key, value);
    },
    syncGetCount: () => getCount,
    changeListenerCount: () => listeners.size,
    setAuthToken: (token) => {
      authToken = token;
      chromeStub.runtime.lastError = token ? undefined : { message: 'not signed in' };
    },
  };
};
