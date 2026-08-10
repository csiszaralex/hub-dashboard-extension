type StorageChange = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, StorageChange>, area: string) => void;

type AlarmCreateInfo = { when?: number; delayInMinutes?: number; periodInMinutes?: number };
type Alarm = { name: string; scheduledTime: number; periodInMinutes?: number };
type AlarmListener = (alarm: Alarm) => void;
type InstalledDetails = { reason: string; previousVersion?: string };
type InstalledListener = (details: InstalledDetails) => void;

type MessageSender = { id: string; url: string };
type SendResponse = (response?: unknown) => void;
type MessageListener = (
  message: unknown,
  sender: MessageSender,
  sendResponse: SendResponse,
) => boolean | void;

/** Only the shape matters; Chrome hands out a 32-character extension id. */
const EXTENSION_ID = 'hubtestextensionidaaaaaaaaaaaaaa';

/**
 * Only the subset `basic` notifications use. The real API also supports
 * `image`, `list` and `progress` types with their own required fields; those
 * are not modelled because nothing in this codebase creates them.
 */
type NotificationOptions = {
  type?: string;
  iconUrl?: string;
  title?: string;
  message?: string;
  [key: string]: unknown;
};

/** `chrome.storage.local.QUOTA_BYTES` — 10 MB, unless `unlimitedStorage` is granted. */
const LOCAL_QUOTA_BYTES = 10_485_760;

/**
 * `chrome.storage` stores values as JSON, so what comes back out is always a
 * copy and never the object that went in, and anything JSON cannot represent
 * (a Blob, a Response, a function, `undefined`) is dropped or rejected outright.
 * Round-tripping here stops a test from passing on a value the real API would
 * mangle.
 */
const serialize = (value: unknown): unknown => {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError('Error in invocation of storage.set(object items): value is not serializable');
  }
  return JSON.parse(json) as unknown;
};

const storedBytes = (store: Map<string, unknown>): number => {
  let total = 0;
  for (const [key, value] of store) total += key.length + JSON.stringify(value).length;
  return total;
};

export interface ChromeStub {
  /** Seed sync storage before the code under test reads it. */
  seedSync: (values: Record<string, unknown>) => void;
  /** Seed local storage before the code under test reads it. */
  seedLocal: (values: Record<string, unknown>) => void;
  /** Current value of a local storage key, or `undefined` when it was never written. */
  readLocal: (key: string) => unknown;
  /** Number of `storage.sync.get` calls — used to assert we read settings once, not once per hook. */
  syncGetCount: () => number;
  /** Number of registered `storage.onChanged` listeners. */
  changeListenerCount: () => number;
  /** Every `alarms.create` call in order — a replacement shows up as a second entry. */
  createdAlarms: () => { name: string; info: AlarmCreateInfo }[];
  /** Alarms currently scheduled, i.e. what `alarms.get` would hand back. */
  scheduledAlarms: () => Alarm[];
  /**
   * Registers an alarm that already existed before the code under test ran —
   * Chrome keeps pending alarms across a browser restart and delivers an
   * overdue one shortly afterwards, which is a state no `alarms.create` call in
   * this run can produce. Deliberately absent from `createdAlarms()`, which
   * records only what this run created.
   */
  seedAlarm: (name: string, scheduledTime: number) => void;
  /** Delivers `onAlarm` for a scheduled alarm. Throws when nothing scheduled it. */
  fireAlarm: (name: string) => void;
  /** Delivers `runtime.onInstalled`. */
  fireInstalled: (reason: string) => void;
  /** Delivers `runtime.onStartup`. */
  fireStartup: () => void;
  /** Token handed back by `identity.getAuthToken`; `null` simulates a signed-out user. */
  setAuthToken: (token: string | null) => void;
  /** Every notification successfully created, in order. */
  sentNotifications: () => NotificationOptions[];
  /** Every `runtime.sendMessage` payload in order, whether or not anything received it. */
  sentMessages: () => unknown[];
}

/**
 * Installs a fake `chrome` global backed by an in-memory store.
 *
 * `storage.sync.get` resolves on a microtask like the real API does, so tests
 * exercise the same "settings arrive after first render" ordering as Chrome.
 */
export const installChromeStub = (): ChromeStub => {
  const store = new Map<string, unknown>();
  const localStore = new Map<string, unknown>();
  const listeners = new Set<ChangeListener>();
  const alarmLog: { name: string; info: AlarmCreateInfo }[] = [];
  const alarmRegistry = new Map<string, Alarm>();
  const alarmListeners = new Set<AlarmListener>();
  const installedListeners = new Set<InstalledListener>();
  const startupListeners = new Set<() => void>();
  const messageListeners = new Set<MessageListener>();
  const notifications: NotificationOptions[] = [];
  const messageLog: unknown[] = [];
  let getCount = 0;
  let authToken: string | null = null;

  /**
   * Chrome reports a failed call through `runtime.lastError` — readable only
   * from inside the callback — rather than by throwing. A caller that passes no
   * callback gets the "Unchecked runtime.lastError" console warning and nothing
   * else, so there is nothing to report here either.
   */
  const failCallback = (cb: SendResponse | undefined, message: string) => {
    if (!cb) return;
    chromeStub.runtime.lastError = { message };
    cb(undefined);
    chromeStub.runtime.lastError = undefined;
  };

  const deliverMessage = (message: unknown, cb?: SendResponse) => {
    // Chrome delivers to the listeners of every *other* context, never back to
    // the sender's own. Tests run page and worker code in one realm, so that
    // split is not modelled; nothing in this codebase both sends and listens.
    const sender: MessageSender = {
      id: EXTENSION_ID,
      url: `chrome-extension://${EXTENSION_ID}/index.html`,
    };

    // A message nobody is listening for is not silently fine: it is exactly
    // what a typo'd message type or an unregistered handler produces, and
    // Chrome says so.
    if (messageListeners.size === 0) {
      failCallback(cb, 'Could not establish connection. Receiving end does not exist.');
      return;
    }

    let responded = false;
    let keepChannelOpen = false;
    const sendResponse: SendResponse = (response) => {
      if (responded) return;
      responded = true;
      cb?.(response);
    };

    for (const listener of messageListeners) {
      // Only a literal `true` keeps the response channel open. An `async`
      // listener returns a Promise — truthy, but Chrome closes the channel
      // regardless, which is the classic MV3 "message port closed before a
      // response was received" bug. Anything other than `true` means "no
      // answer is coming".
      if (listener(message, sender, sendResponse) === true) keepChannelOpen = true;
    }

    if (!responded && !keepChannelOpen) {
      failCallback(cb, 'The message port closed before a response was received.');
    }
  };

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
            // Chrome omits `oldValue` entirely for a key that did not exist,
            // rather than reporting it as `undefined` — code that distinguishes
            // a first write from an overwrite with `'oldValue' in change` has to
            // see the same thing here.
            changes[key] = store.has(key)
              ? { oldValue: store.get(key), newValue: value }
              : { newValue: value };
            store.set(key, value);
          }
          queueMicrotask(() => {
            listeners.forEach((l) => l(changes, 'sync'));
            cb?.();
          });
        },
      },
      local: {
        // A key that was never written is absent from the result object rather
        // than present with an `undefined` value, exactly as in Chrome — code
        // that relies on the key existing must fail here too.
        get: (keys: string[] | string, cb: (items: Record<string, unknown>) => void) => {
          const wanted = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of wanted) {
            if (localStore.has(key)) result[key] = serialize(localStore.get(key));
          }
          queueMicrotask(() => cb(result));
        },
        // `onChanged` fires for the local area too, not just for sync — that is
        // how a second tab learns about a write it did not make, and how the
        // page learns about one the service worker made. A stub that stayed
        // silent here would let a component that never subscribes look correct.
        set: (items: Record<string, unknown>, cb?: () => void) => {
          const pending = new Map(localStore);
          const changes: Record<string, StorageChange> = {};
          for (const [key, value] of Object.entries(items)) {
            const next = serialize(value);
            // As above: no `oldValue` property at all for a key that was never
            // written, which is what Chrome reports.
            changes[key] = localStore.has(key)
              ? { oldValue: localStore.get(key), newValue: next }
              : { newValue: next };
            pending.set(key, next);
          }

          // Over quota the write is refused and the failure is reported through
          // `runtime.lastError` — silently accepting megabytes here would hide
          // exactly the mistake this store exists to avoid (image bytes belong
          // in the Cache API, not in `chrome.storage`). A refused write changes
          // nothing, so it announces nothing either.
          if (storedBytes(pending) > LOCAL_QUOTA_BYTES) {
            queueMicrotask(() => {
              chromeStub.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
              cb?.();
              chromeStub.runtime.lastError = undefined;
            });
            return;
          }

          for (const [key, value] of pending) localStore.set(key, value);
          queueMicrotask(() => {
            listeners.forEach((l) => l(changes, 'local'));
            cb?.();
          });
        },
        remove: (keys: string[] | string, cb?: () => void) => {
          const unwanted = Array.isArray(keys) ? keys : [keys];
          const changes: Record<string, StorageChange> = {};
          for (const key of unwanted) {
            // Removing a key that was never there is not a change, so Chrome
            // reports nothing for it. The removal that did happen arrives with
            // `oldValue` and no `newValue` at all.
            if (!localStore.has(key)) continue;
            changes[key] = { oldValue: localStore.get(key) };
            localStore.delete(key);
          }
          queueMicrotask(() => {
            if (Object.keys(changes).length > 0) listeners.forEach((l) => l(changes, 'local'));
            cb?.();
          });
        },
      },
      onChanged: {
        addListener: (l: ChangeListener) => listeners.add(l),
        removeListener: (l: ChangeListener) => listeners.delete(l),
      },
    },
    alarms: {
      /**
       * Chrome cancels and replaces an alarm that already carries this name, so
       * creating one again restarts its clock instead of adding a second alarm.
       * Modelling the replacement is what lets a test notice a `create` on every
       * browser start pushing a 24 h alarm permanently out of reach.
       *
       * A `when` already in the past is kept rather than dropped: Chrome fires
       * such an alarm at the next opportunity, so `fireAlarm` must still be
       * able to deliver it.
       *
       * Note that Chrome also clamps anything under ~30 seconds up to that
       * floor for a released extension. That is not modelled because the
       * shortest thing scheduled here is a one-minute Pomodoro phase, which is
       * comfortably above it — but only comfortably, so a shorter phase length
       * would need this modelled before it could be trusted.
       */
      create: (name: string | AlarmCreateInfo, info?: AlarmCreateInfo, cb?: () => void) => {
        const alarmName = typeof name === 'string' ? name : '';
        const createInfo = (typeof name === 'string' ? info : name) ?? {};

        if (createInfo.when !== undefined && createInfo.delayInMinutes !== undefined) {
          throw new TypeError('Error: Cannot set both when and delayInMinutes');
        }
        // A repeating alarm may omit both: `periodInMinutes` then doubles as the
        // initial delay. With none of the three there is nothing to schedule.
        const delayMinutes = createInfo.delayInMinutes ?? createInfo.periodInMinutes;
        if (createInfo.when === undefined && delayMinutes === undefined) {
          throw new TypeError('Error: Alarm requires when, delayInMinutes or periodInMinutes');
        }

        alarmLog.push({ name: alarmName, info: createInfo });
        alarmRegistry.set(alarmName, {
          name: alarmName,
          scheduledTime: createInfo.when ?? Date.now() + (delayMinutes as number) * 60_000,
          periodInMinutes: createInfo.periodInMinutes,
        });
        queueMicrotask(() => cb?.());
      },
      get: (name: string | undefined, cb: (alarm?: Alarm) => void) =>
        queueMicrotask(() => cb(alarmRegistry.get(name ?? ''))),
      getAll: (cb: (alarms: Alarm[]) => void) =>
        queueMicrotask(() => cb([...alarmRegistry.values()])),
      clear: (name: string | undefined, cb?: (wasCleared: boolean) => void) => {
        const cleared = alarmRegistry.delete(name ?? '');
        queueMicrotask(() => cb?.(cleared));
      },
      onAlarm: {
        addListener: (l: AlarmListener) => alarmListeners.add(l),
      },
    },
    identity: {
      getAuthToken: (_options: { interactive: boolean }, cb: (token: string) => void) =>
        queueMicrotask(() => cb(authToken as string)),
    },
    notifications: {
      /**
       * Like `alarms.create` and `storage.set`'s serialization check above,
       * Chrome validates a notification's options against its schema before
       * the call reaches the browser process — a `basic` notification missing
       * `type`, `iconUrl`, `title` or `message` throws synchronously rather
       * than silently creating a notification nobody would ever see.
       */
      create: (id: string, options: NotificationOptions, cb?: (id: string) => void) => {
        const required: (keyof NotificationOptions)[] = ['type', 'iconUrl', 'title', 'message'];
        const missing = required.filter((key) => options?.[key] === undefined);
        if (missing.length > 0) {
          throw new TypeError(
            `Error in invocation of notifications.create(string notificationId, NotificationOptions options, function callback): Error at parameter 'options': Missing required properties: ${missing.join(', ')}.`,
          );
        }
        notifications.push(options);
        queueMicrotask(() => cb?.(id));
      },
    },
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined as { message: string } | undefined,
      onInstalled: {
        addListener: (l: InstalledListener) => installedListeners.add(l),
      },
      onStartup: {
        addListener: (l: () => void) => startupListeners.add(l),
      },
      onMessage: {
        addListener: (l: MessageListener) => messageListeners.add(l),
        removeListener: (l: MessageListener) => messageListeners.delete(l),
      },
      /**
       * Delivery is asynchronous, so a sender never observes the receiver's
       * work before yielding — code that assumes otherwise (reading storage
       * straight after `sendMessage` and expecting the new value) must fail
       * here the way it fails in Chrome.
       */
      sendMessage: (message: unknown, cb?: SendResponse) => {
        messageLog.push(message);
        queueMicrotask(() => deliverMessage(message, cb));
      },
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

  return {
    seedSync: (values) => {
      for (const [key, value] of Object.entries(values)) store.set(key, value);
    },
    seedLocal: (values) => {
      for (const [key, value] of Object.entries(values)) localStore.set(key, serialize(value));
    },
    readLocal: (key) => localStore.get(key),
    syncGetCount: () => getCount,
    changeListenerCount: () => listeners.size,
    createdAlarms: () => [...alarmLog],
    scheduledAlarms: () => [...alarmRegistry.values()],
    seedAlarm: (name, scheduledTime) => alarmRegistry.set(name, { name, scheduledTime }),
    fireAlarm: (name) => {
      const alarm = alarmRegistry.get(name);
      // Chrome never delivers an alarm nobody scheduled, so neither do we: a
      // test that fires one proves the scheduling happened.
      if (!alarm) throw new Error(`No alarm named "${name}" is scheduled`);
      alarmListeners.forEach((l) => l(alarm));
    },
    fireInstalled: (reason) => installedListeners.forEach((l) => l({ reason })),
    fireStartup: () => startupListeners.forEach((l) => l()),
    setAuthToken: (token) => {
      authToken = token;
      chromeStub.runtime.lastError = token ? undefined : { message: 'not signed in' };
    },
    sentNotifications: () => [...notifications],
    sentMessages: () => [...messageLog],
  };
};
