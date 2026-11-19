import manifest from '../../manifest.json';

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
 * `chrome.storage.sync`'s limits: `QUOTA_BYTES`, `QUOTA_BYTES_PER_ITEM` and
 * `MAX_ITEMS`. The write-rate limits (`MAX_WRITE_OPERATIONS_PER_MINUTE` and
 * `_PER_HOUR`) are not modelled: nothing here writes in a loop (the popup's
 * text fields write once per pause, see `useDraftSetting`'s
 * `DRAFT_SAVE_DELAY_MS`), and a test would have to make over a hundred calls
 * to reach one.
 */
const SYNC_QUOTA_BYTES = 102_400;
const SYNC_QUOTA_BYTES_PER_ITEM = 8_192;
const SYNC_MAX_ITEMS = 512;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A match pattern from the manifest, as a test for the origin patterns code
 * asks `permissions.request` for: `*` as the whole host is any host, `*.` a
 * subdomain wildcard, and the path is compared literally, since a request names
 * a pattern such as `https://memos.example.test/*` rather than a URL.
 */
const toOriginPattern = (pattern: string): RegExp => {
  const [scheme, rest] = pattern.split('://');
  const slash = rest.indexOf('/');
  const host = rest.slice(0, slash);
  const hostRe =
    host === '*'
      ? '[^/]+'
      : host.startsWith('*.')
        ? `(?:[^/]+\\.)?${escapeRegExp(host.slice(2))}`
        : escapeRegExp(host);
  return new RegExp(`^${escapeRegExp(scheme)}:\\/\\/${hostRe}${escapeRegExp(rest.slice(slash))}$`);
};

/**
 * Read from `optional_host_permissions` in `manifest.json` itself. Chrome
 * refuses to request anything outside it, so the stub must too, and a copy of
 * the list here would be one more place for a forgotten manifest entry to hide.
 */
const OPTIONAL_HOST_PATTERNS = (manifest.optional_host_permissions ?? []).map(toOriginPattern);

/**
 * What a non-interactive `identity.getAuthToken` fails with when it would need
 * a prompt: no account signed in to Chrome, or one whose grant is gone. Worded
 * as Chromium's `kUserNotSignedIn` and `kNoGrant` (`identity_constants.h`).
 */
const NOT_SIGNED_IN = 'The user is not signed in.';
const GRANT_REVOKED = 'OAuth2 not granted or revoked.';

/**
 * Chrome parses and validates a match pattern's shape — before `contains`,
 * `request` or `remove` do anything else with it — the same way for all
 * three, so this is shared rather than repeated per call site. Manifest
 * membership is a separate check that only `request` applies (see below).
 */
const assertValidOriginPattern = (origin: string, caller: 'contains' | 'request' | 'remove') => {
  if (!/^[a-z-]+:\/\/[^/]+\/./.test(origin)) {
    throw new TypeError(
      `Error in invocation of permissions.${caller}(object permissions, optional function callback): Invalid value for origin pattern: ${origin}`,
    );
  }
};

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

const utf8 = new TextEncoder();

/**
 * Chromium's JSON writer escapes `<`, U+2028 and U+2029 as six-byte unicode
 * escapes, which `JSON.stringify` leaves as one, three and three bytes.
 */
const CHROME_ONLY_ESCAPES = new RegExp(
  `[<${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
  'g',
);

/**
 * What Chrome counts for one item against a storage quota: the byte length of
 * the key plus that of the value's JSON as Chromium writes it
 * (`SettingsStorageQuotaEnforcer` in Chromium). Bytes, not UTF-16 code units,
 * so accented text weighs what it really does.
 *
 * Written out here rather than imported from `utils/customQuotes`'s
 * `syncItemBytes`: a stub that measured with the code under test would agree
 * with any mistake in it.
 */
const itemBytes = (key: string, value: unknown): number => {
  const json = JSON.stringify(value) ?? '';
  let extra = 0;
  for (const [char] of json.matchAll(CHROME_ONLY_ESCAPES)) extra += char === '<' ? 5 : 3;
  return utf8.encode(key).length + utf8.encode(json).length + extra;
};

const storedBytes = (store: Map<string, unknown>): number => {
  let total = 0;
  for (const [key, value] of store) total += itemBytes(key, value);
  return total;
};

/**
 * Why Chrome would refuse a `storage.sync.set` that leaves the area as
 * `pending`, in the order Chrome checks: each written item's size, then the
 * total and the item count. `null` when it fits.
 */
const syncQuotaError = (items: Record<string, unknown>, pending: Map<string, unknown>) => {
  for (const [key, value] of Object.entries(items)) {
    if (itemBytes(key, value) > SYNC_QUOTA_BYTES_PER_ITEM) {
      return 'QUOTA_BYTES_PER_ITEM quota exceeded';
    }
  }
  if (storedBytes(pending) > SYNC_QUOTA_BYTES) return 'QUOTA_BYTES quota exceeded';
  if (pending.size > SYNC_MAX_ITEMS) return 'MAX_ITEMS quota exceeded';
  return null;
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
  /** Number of `runtime.openOptionsPage` calls. */
  optionsPageOpens: () => number;
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
  /**
   * Puts `token` in Chrome's token cache, as for a user who signed in and
   * consented earlier, so `identity.getAuthToken` hands it out without a
   * prompt. `null` simulates a signed-out user: nothing cached.
   */
  setAuthToken: (token: string | null) => void;
  /**
   * The token an interactive `getAuthToken` obtains when nothing is cached, as
   * if the user completed the sign-in prompt. `null`, the default, is the user
   * closing it.
   */
  completePromptWith: (token: string | null) => void;
  /**
   * Google stops accepting the cached token, while Chrome keeps handing it out
   * until `removeCachedAuthToken` drops it; after that, `fresh` comes back
   * without a prompt.
   */
  expireCachedToken: (fresh: string) => void;
  /**
   * The user revoked the grant: the cached token is rejected, and once it is
   * removed a new one cannot be had without a prompt.
   */
  revokeGrant: () => void;
  /** Whether Google would accept `token` — for a test's `fetch` fake to answer 401 by. */
  acceptsToken: (token: string | null) => boolean;
  /** Every token passed to `removeCachedAuthToken`, in order. */
  removedTokens: () => string[];
  /** Every `getAuthToken` call in order, by whether it was interactive. */
  authTokenRequests: () => { interactive: boolean }[];
  /** Pre-grants optional host permissions, as a returning user would already have. */
  grantOrigins: (patterns: string[]) => void;
  /** Makes the next `permissions.request` resolve false, as a refused prompt does. */
  denyPermissionRequests: () => void;
  /** Current value of a sync storage key — the mirror of `readLocal`. */
  readSync: (key: string) => unknown;
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
  /**
   * Chrome's two calling conventions: with a callback a call returns nothing
   * and hands the callback its result a microtask later; without one it
   * returns a Promise of that result. Code written against the Promise form
   * chains `.catch` on it, which would throw on the callback form's `undefined`.
   */
  const reply = <T>(result: T, cb?: (result: T) => void): Promise<T> | undefined => {
    if (!cb) return new Promise((resolve) => queueMicrotask(() => resolve(result)));
    queueMicrotask(() => cb(result));
    return undefined;
  };
  const messageLog: unknown[] = [];
  let getCount = 0;
  let optionsOpens = 0;
  /** What Chrome's in-memory token cache holds: handed out without a prompt. */
  let cachedToken: string | null = null;
  /** Takes the cached token's place once it is removed; see `expireCachedToken`. */
  let replacementToken: string | null = null;
  /** What an interactive call obtains when nothing is cached; `null` is the user closing the prompt. */
  let promptToken: string | null = null;
  /** Why a non-interactive call failed, in Chrome's words. */
  let nonInteractiveFailure = NOT_SIGNED_IN;
  /** Tokens Google would accept: issued by this stub and not since rejected. */
  const issuedTokens = new Set<string>();
  const removedTokenLog: string[] = [];
  const identityCalls: { interactive: boolean }[] = [];
  const grantedOrigins = new Set<string>();
  let grantPermissionRequests = true;

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
        // `null` asks for the whole area, as in Chrome — the settings store
        // reads everything so a migration can see keys that are no longer
        // settings.
        get: (keys: string[] | string | null, cb: (items: Record<string, unknown>) => void) => {
          getCount++;
          const wanted = keys === null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of wanted) {
            if (store.has(key)) result[key] = store.get(key);
          }
          queueMicrotask(() => cb(result));
        },
        /**
         * Over any of sync's quotas the whole call is refused — every item in
         * it, not just the one that is too big — and nothing is written or
         * announced. This store is small enough (8 KB an item) that a user's
         * own data reaches the limit, and a stub without it let a save that
         * Chrome rejects look like one that worked.
         *
         * Called with a callback, the failure arrives as `runtime.lastError`
         * inside it; called without one, Chrome returns a Promise instead and
         * rejects it.
         */
        set: (items: Record<string, unknown>, cb?: () => void): Promise<void> | undefined => {
          const pending = new Map(store);
          const changes: Record<string, StorageChange> = {};
          for (const [key, value] of Object.entries(items)) {
            // Chrome omits `oldValue` entirely for a key that did not exist,
            // rather than reporting it as `undefined` — code that distinguishes
            // a first write from an overwrite with `'oldValue' in change` has to
            // see the same thing here.
            changes[key] = store.has(key)
              ? { oldValue: store.get(key), newValue: value }
              : { newValue: value };
            pending.set(key, value);
          }

          const error = syncQuotaError(items, pending);
          if (!error) {
            for (const [key, value] of pending) store.set(key, value);
          }

          const announce = () => {
            if (!error) listeners.forEach((l) => l(changes, 'sync'));
          };
          if (!cb) {
            return new Promise<void>((resolve, reject) =>
              queueMicrotask(() => {
                announce();
                if (error) reject(new Error(error));
                else resolve();
              }),
            );
          }
          queueMicrotask(() => {
            announce();
            if (!error) {
              cb();
              return;
            }
            chromeStub.runtime.lastError = { message: error };
            cb();
            chromeStub.runtime.lastError = undefined;
          });
          return undefined;
        },
        // Same reporting as `local.remove` below: nothing for a key that was
        // never there, and `oldValue` with no `newValue` for one that was.
        remove: (keys: string[] | string, cb?: () => void) => {
          const unwanted = Array.isArray(keys) ? keys : [keys];
          const changes: Record<string, StorageChange> = {};
          for (const key of unwanted) {
            if (!store.has(key)) continue;
            changes[key] = { oldValue: store.get(key) };
            store.delete(key);
          }
          const announce = () => {
            if (Object.keys(changes).length > 0) listeners.forEach((l) => l(changes, 'sync'));
          };
          if (!cb) {
            return new Promise<void>((resolve) =>
              queueMicrotask(() => {
                announce();
                resolve();
              }),
            );
          }
          queueMicrotask(() => {
            announce();
            cb();
          });
          return undefined;
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
        return reply(undefined, cb);
      },
      get: (name: string | undefined, cb: (alarm?: Alarm) => void) =>
        queueMicrotask(() => cb(alarmRegistry.get(name ?? ''))),
      getAll: (cb: (alarms: Alarm[]) => void) =>
        queueMicrotask(() => cb([...alarmRegistry.values()])),
      clear: (name: string | undefined, cb?: (wasCleared: boolean) => void) => {
        return reply(alarmRegistry.delete(name ?? ''), cb);
      },
      onAlarm: {
        addListener: (l: AlarmListener) => alarmListeners.add(l),
      },
    },
    identity: {
      /**
       * Hands out the cached token when there is one, interactive or not.
       * Without one, only an interactive call can get a new token (the
       * "prompt"), and a non-interactive call fails: Chrome's docs say it
       * "will return failure any time a prompt would be required", and a stub
       * that answered anyway let code that never asks the user look signed in.
       *
       * Chrome reports the failure through `runtime.lastError` in the callback
       * form, which receives the token as a plain first argument, and by
       * rejecting in the Promise form, which resolves with `{ token }` instead.
       * `grantedScopes` is left out: Chrome supplies it only "when available",
       * and nothing here reads it.
       */
      getAuthToken: (
        options?: { interactive?: boolean },
        cb?: (token?: string) => void,
      ): Promise<{ token?: string }> | undefined => {
        identityCalls.push({ interactive: options?.interactive === true });
        const outcome = (): string | Error => {
          if (cachedToken) return cachedToken;
          if (options?.interactive && promptToken) {
            cachedToken = promptToken;
            issuedTokens.add(promptToken);
            return cachedToken;
          }
          // Chromium's `kUserRejected`: the prompt was closed.
          if (options?.interactive) return new Error('The user did not approve access.');
          return new Error(nonInteractiveFailure);
        };
        if (!cb) {
          return new Promise((resolve, reject) =>
            queueMicrotask(() => {
              const result = outcome();
              if (result instanceof Error) reject(result);
              else resolve({ token: result });
            }),
          );
        }
        queueMicrotask(() => {
          const result = outcome();
          if (result instanceof Error) {
            failCallback(() => cb(), result.message);
            return;
          }
          cb(result);
        });
        return undefined;
      },
      /**
       * Drops the token from Chrome's cache, which is all it does: it does not
       * revoke anything at Google. What the next `getAuthToken` returns is the
       * replacement a test arranged with `expireCachedToken`, or nothing
       * without a prompt after `revokeGrant`.
       */
      removeCachedAuthToken: (
        details: { token: string },
        cb?: () => void,
      ): Promise<void> | undefined => {
        removedTokenLog.push(details.token);
        if (cachedToken === details.token) {
          cachedToken = replacementToken;
          if (replacementToken) issuedTokens.add(replacementToken);
          replacementToken = null;
        }
        if (!cb) return new Promise((resolve) => queueMicrotask(resolve));
        queueMicrotask(cb);
        return undefined;
      },
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
        return reply(id, cb);
      },
    },
    permissions: {
      /**
       * Shape is validated on both `contains` and `request`, but manifest
       * membership only on `request`: `contains` is a plain query against
       * whatever the extension currently holds, and Chrome answers `false`
       * for an origin it doesn't have — it does not throw. Mirroring the
       * membership check here too would make the stub stricter than the
       * real API, the same infidelity as not modelling it at all.
       */
      contains: (options: { origins?: string[] }, cb: (result: boolean) => void) => {
        const wanted = options.origins ?? [];
        for (const origin of wanted) assertValidOriginPattern(origin, 'contains');
        const held = wanted.every((origin) => grantedOrigins.has(origin));
        queueMicrotask(() => cb(held));
      },
      /**
       * Chrome rejects an origin that `optional_host_permissions` does not
       * cover, on top of the shape check above — modelling only the prompt
       * would let a forgotten manifest entry pass a green test and fail on
       * install.
       *
       * The real API also requires a user gesture. That has no meaning in
       * happy-dom, so it is not modelled; what is modelled is the part a test
       * can get wrong — that the answer may be `false`.
       */
      request: (options: { origins?: string[] }, cb: (granted: boolean) => void) => {
        for (const origin of options.origins ?? []) {
          assertValidOriginPattern(origin, 'request');
          if (!OPTIONAL_HOST_PATTERNS.some((pattern) => pattern.test(origin))) {
            throw new Error(
              'Error: Optional permissions must be listed in the extension manifest.',
            );
          }
        }

        if (grantPermissionRequests) {
          for (const origin of options.origins ?? []) grantedOrigins.add(origin);
        }
        queueMicrotask(() => cb(grantPermissionRequests));
      },
      /**
       * Shape-validated like the other two. Needs no user gesture and shows no
       * prompt. Reports `true` when something held was actually given up; what
       * Chrome reports for an origin that was never held is not modelled as
       * meaningful, so code must not branch on the answer.
       */
      remove: (options: { origins?: string[] }, cb?: (removed: boolean) => void) => {
        const unwanted = options.origins ?? [];
        for (const origin of unwanted) assertValidOriginPattern(origin, 'remove');
        let removed = false;
        for (const origin of unwanted) removed = grantedOrigins.delete(origin) || removed;
        queueMicrotask(() => cb?.(removed));
      },
    },
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined as { message: string } | undefined,
      // Resolves once the page is open, as Chrome's promise form does.
      openOptionsPage: async () => {
        optionsOpens++;
      },
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
    optionsPageOpens: () => optionsOpens,
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
      cachedToken = token;
      replacementToken = null;
      nonInteractiveFailure = NOT_SIGNED_IN;
      if (token) issuedTokens.add(token);
    },
    completePromptWith: (token) => {
      promptToken = token;
    },
    expireCachedToken: (fresh) => {
      if (cachedToken) issuedTokens.delete(cachedToken);
      replacementToken = fresh;
    },
    revokeGrant: () => {
      if (cachedToken) issuedTokens.delete(cachedToken);
      replacementToken = null;
      nonInteractiveFailure = GRANT_REVOKED;
    },
    acceptsToken: (token) => token !== null && issuedTokens.has(token),
    removedTokens: () => [...removedTokenLog],
    authTokenRequests: () => [...identityCalls],
    grantOrigins: (patterns) => {
      for (const pattern of patterns) grantedOrigins.add(pattern);
    },
    denyPermissionRequests: () => {
      grantPermissionRequests = false;
    },
    readSync: (key) => store.get(key),
    sentNotifications: () => [...notifications],
    sentMessages: () => [...messageLog],
  };
};
