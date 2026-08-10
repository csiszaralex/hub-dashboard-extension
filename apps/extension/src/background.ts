import en from './i18n/locales/en.json';
import hu from './i18n/locales/hu.json';
import { DEFAULT_UNSPLASH_QUERY } from './utils/api';
import { deleteObsoleteImageCaches } from './utils/imageCache';
import {
  clampPomodoroMinutes,
  DEFAULT_BREAK_MINUTES,
  DEFAULT_WORK_MINUTES,
  nextPhase,
  phaseDurationMs,
  type PomodoroPhase,
} from './utils/pomodoro';
import {
  IDLE_POMODORO,
  POMODORO_ALARM,
  readPomodoroState,
  writePomodoroState,
  type PomodoroMessage,
} from './utils/pomodoroState';
import { prefetchBackground } from './utils/prefetch';

/**
 * The dashboard needs little background processing, so the service worker has
 * only housekeeping jobs and one piece of real state.
 *
 * 1. Drop image caches written by an older format — an extension update is the
 *    only moment where a previous version's bucket can be identified.
 * 2. Prefetch tomorrow's background so the new tab page never waits on the
 *    network. Chrome fires a missed alarm shortly after the next startup, and
 *    the page falls back to fetching on demand anyway, so a machine asleep when
 *    the alarm is due degrades to the previous behaviour rather than breaking.
 * 3. Own the Pomodoro timer. It used to live in `usePomodoro`, which made it
 *    per-tab: two new tabs disagreed about the remaining time, and each one
 *    raised its own system notification at a phase change. Here there is one
 *    deadline, one alarm and one notification, and the timer keeps running with
 *    no tab open at all.
 *
 * Everything here must survive being killed mid-flight: an MV3 worker is torn
 * down whenever it goes idle. Nothing below holds state between events — the
 * timer's state is read back out of `chrome.storage.local` every time.
 */
const PREFETCH_ALARM = 'prefetch-background';

const scheduleAlarm = () => {
  // Creating an alarm that already exists cancels the old one and restarts its
  // 24 h clock. Since this runs on every browser start, an unconditional create
  // would push the prefetch permanently out of reach for anyone who restarts
  // Chrome daily — so only create the alarm when it is genuinely missing.
  chrome.alarms.get(PREFETCH_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(PREFETCH_ALARM, { periodInMinutes: 24 * 60 });
  });
};

const tomorrowIso = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

const runPrefetch = () => {
  // No React out here, so settings come straight from storage rather than
  // through `useSettings`.
  chrome.storage.sync.get(['unsplashQuery', 'backgroundSource'], (settings) => {
    // A custom background needs no prefetching.
    if (settings.backgroundSource === 'custom') return;
    // `unsplashQuery` is absent until the popup is saved, so the fallback has to
    // be the page's own default — shared from `utils/api`, since a packet built
    // with any other query is one the page will refuse to adopt. `??` and not
    // `||`, to mirror how `useSettings.merge` treats a deliberately empty query.
    const query = (settings.unsplashQuery as string) ?? DEFAULT_UNSPLASH_QUERY;
    void prefetchBackground(query, tomorrowIso());
  });
};

/* -------------------------------------------------------------------------- */
/* Pomodoro                                                                   */
/* -------------------------------------------------------------------------- */

interface PomodoroSettings {
  work: number;
  break: number;
  language: string;
}

const readPomodoroSettings = (): Promise<PomodoroSettings> =>
  new Promise((resolve) => {
    // One read for everything the transition needs, including the language, so
    // the notification below cannot be raised with a stale one.
    chrome.storage.sync.get(
      ['pomodoroWorkMinutes', 'pomodoroBreakMinutes', 'language'],
      (settings) => {
        resolve({
          // Clamped here for the same reason `useSettings.merge` clamps: the
          // popup is not the only way a value reaches sync storage, and a zero
          // or NaN length would schedule an alarm that never usefully fires.
          work: clampPomodoroMinutes(settings.pomodoroWorkMinutes, DEFAULT_WORK_MINUTES),
          break: clampPomodoroMinutes(settings.pomodoroBreakMinutes, DEFAULT_BREAK_MINUTES),
          language: typeof settings.language === 'string' ? settings.language : '',
        });
      },
    );
  });

/**
 * The two notification strings, read straight out of the locale files.
 *
 * The page resolves strings through `i18n/i18n.ts`, and the worker deliberately
 * does not import it: that module installs the `react-i18next` binding, so
 * importing it drags React into a worker Chrome restarts for every alarm, and
 * it applies the saved language asynchronously — one storage round-trip after
 * `init` resolves — so a cold-started worker could notify in the wrong language
 * before that landed. The strings themselves still live only in `en.json` and
 * `hu.json`; only the lookup is local.
 *
 * ADDING A LOCALE: a new `src/i18n/locales/*.json` is picked up automatically by
 * the page — `AVAILABLE_LANGUAGES` is read from that directory at build time —
 * but NOT here. The worker cannot go through `i18n/i18n.ts`, so a new locale
 * must be imported and added to this map by hand. Nothing warns if you forget:
 * `pomodoroStrings` falls back to English below, so a user with the whole UI in
 * the new language would silently get English notifications only.
 */
const LOCALES: Record<string, typeof en.pomodoro> = { en: en.pomodoro, hu: hu.pomodoro };

const detectLanguage = (): string => {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const lang of preferred) {
    const code = lang.split('-')[0];
    if (code in LOCALES) return code;
  }
  return Object.keys(LOCALES)[0];
};

/** `language` is `''` until the popup saves one, which means "follow the browser". */
const pomodoroStrings = (language: string) => LOCALES[language] ?? LOCALES[detectLanguage()];

const notify = (phase: PomodoroPhase, language: string) => {
  // `notifications` is declared in manifest.json, so this API is present in
  // every real extension context — but the alarm handler is the one path that
  // must not throw, since a throw here would lose the transition that has
  // already been written and scheduled.
  if (typeof chrome === 'undefined' || !chrome.notifications) return;

  const strings = pomodoroStrings(language);
  chrome.notifications.create(`hub-pomodoro-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: strings.notificationTitle,
    message: phase === 'break' ? strings.breakStarted : strings.workStarted,
  });
};

/**
 * State first, alarm second — in all three handlers below.
 *
 * A worker killed between the two steps then leaves a state with no alarm to
 * advance it: the tabs keep rendering a countdown that runs to 00:00 and stops,
 * and the user's next Start or Reset puts it right. The other order leaves an
 * alarm for a phase that was never recorded, and `advancePomodoro` reads the
 * state it finds — an idle one — and returns without rescheduling, so the timer
 * dies silently and, worse, `reset` would fire a notification for a session the
 * user had already ended. A visibly stuck timer beats an invisible one.
 */
/**
 * Counts Start and Reset commands, bumped before either handler's first `await`.
 *
 * The stored `epoch` cannot close a race inside a single round of the event
 * loop: `chrome.storage.local.get` snapshots its value when it is *called* and
 * hands it over a turn later, so a write issued in between is invisible to a
 * read already in flight. Two handlers that begin in the same round therefore
 * both compare a stale epoch against itself and both pass.
 *
 * This counter is read and written synchronously, so a transition can check it
 * in the same uninterrupted block as its own write. It is in memory on purpose:
 * a race needs two handlers alive in one worker, and a worker torn down takes
 * both with it. `epoch` remains the durable backstop across restarts.
 */
let sessionCommands = 0;

const startPomodoro = async () => {
  const command = ++sessionCommands;
  const [current, settings] = await Promise.all([readPomodoroState(), readPomodoroSettings()]);
  const endsAt = Date.now() + phaseDurationMs('work', settings.work, settings.break);
  // A newer Start or Reset has already spoken for the session.
  if (sessionCommands !== command) return;

  await writePomodoroState({ phase: 'work', endsAt, running: true, epoch: current.epoch + 1 });
  chrome.alarms.create(POMODORO_ALARM, { when: endsAt });
};

const resetPomodoro = async () => {
  const command = ++sessionCommands;
  const current = await readPomodoroState();
  if (sessionCommands !== command) return;

  // The epoch bump is the durable half: it invalidates a transition still in
  // flight in some later worker, so Reset cannot be undone by a phase change
  // that started before it.
  await writePomodoroState({ ...IDLE_POMODORO, epoch: current.epoch + 1 });
  chrome.alarms.clear(POMODORO_ALARM);
};

/**
 * The advance already under way, if there is one.
 *
 * Callers join it rather than queueing behind it. Queueing would impose arrival
 * order, and the alarm is always enqueued before the Reset that follows it — so
 * the transition would run to completion and raise exactly the notification the
 * user cancelled. Joining means a second caller gets the first one's result and
 * no second transition happens at all.
 */
let advanceInFlight: Promise<void> | null = null;

const advancePomodoro = (): Promise<void> => {
  advanceInFlight ??= runAdvance().finally(() => {
    advanceInFlight = null;
  });
  return advanceInFlight;
};

const runAdvance = async () => {
  // Captured before the first `await`, so any Start or Reset invoked from here
  // on is visible to the check below however the two interleave.
  const command = sessionCommands;

  const state = await readPomodoroState();
  // A Reset that raced the alarm — or an alarm left over from a state that was
  // never written — ends here, with nothing rescheduled and nothing announced.
  if (!state.running) return;

  // The phase has not actually elapsed, so somebody else already advanced it and
  // this is the *next* phase's deadline being looked at. Chrome keeps pending
  // alarms across a browser restart and delivers an overdue one shortly after
  // startup, so the delivered alarm and `rehydratePomodoro` both arrive for the
  // same expired phase; without this, the second one to run skips a phase and
  // announces it. An alarm never fires early, so a deadline still in the future
  // always means this call is the duplicate.
  if (state.endsAt !== null && state.endsAt > Date.now()) return;

  const settings = await readPomodoroSettings();
  const upcoming = nextPhase(state.phase);
  const endsAt = Date.now() + phaseDurationMs(upcoming, settings.work, settings.break);

  // Two checks, because they catch different things.
  //
  // The epoch is the durable one: it sees a Start or Reset written by an earlier
  // worker, which nothing in memory could know about. But its re-read is
  // snapshotted a turn before it is delivered, so it is blind to a write issued
  // in the same round — and that is precisely the browser-restart case, where
  // the module scope, `onStartup` and the delivered alarm all begin within
  // microseconds of one another.
  //
  // The command counter covers that: it is written synchronously by
  // `startPomodoro`/`resetPomodoro` and read synchronously here, in the same
  // uninterrupted block as the write below, so there is no window between the
  // check and the write being issued.
  const current = await readPomodoroState();
  if (current.epoch !== state.epoch) return;
  if (sessionCommands !== command) return;

  await writePomodoroState({ phase: upcoming, endsAt, running: true, epoch: state.epoch + 1 });
  chrome.alarms.create(POMODORO_ALARM, { when: endsAt });

  // One more await has passed, so one more chance for a Reset. It wins the state
  // — last writer wins, by design — but the phase it cancelled must not still be
  // announced: a notification arriving after the user pressed Reset is the exact
  // symptom this whole task existed to remove.
  if (sessionCommands !== command) return;
  // Once, here, however many tabs are open — including none.
  notify(upcoming, settings.language);
};

/**
 * Puts the alarm back for a session that outlived its alarm.
 *
 * Chrome drops an extension's alarms on update and on reload, which happens far
 * more often than a worker being killed in the microseconds between the write
 * and the create above — but both leave the same wreckage: a state that says
 * `running` with nothing left to advance it, so every open tab renders a
 * countdown that runs to 00:00 and freezes there.
 *
 * The stored `endsAt` is the source of truth and is never recomputed here: a
 * restart must not hand the user a fresh 25 minutes. If it has already passed —
 * the machine was off, or the update took a while — the phase is advanced
 * immediately rather than scheduling an alarm into the past, which is also what
 * `advancePomodoro` does for a late alarm, and for the same reason.
 *
 * Unlike `scheduleAlarm`, this does not check for an existing alarm first. That
 * gate exists for the prefetch because re-creating a *periodic* alarm restarts
 * its 24 h clock; this one carries an absolute `when`, so re-creating it with
 * the same deadline is a no-op.
 */
const rehydratePomodoro = async () => {
  const state = await readPomodoroState();
  if (!state.running || state.endsAt === null) return;

  if (state.endsAt <= Date.now()) {
    await advancePomodoro();
    return;
  }

  chrome.alarms.create(POMODORO_ALARM, { when: state.endsAt });
};

/* -------------------------------------------------------------------------- */

// Both wake-ups restore both alarms. `onInstalled` fires for a reload and an
// update as well as a first install, and Chrome discards the extension's alarms
// each time — so this is the common path back from a lost Pomodoro alarm, not
// the rare one.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') {
    void deleteObsoleteImageCaches();
  }
  scheduleAlarm();
  void rehydratePomodoro();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarm();
  void rehydratePomodoro();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PREFETCH_ALARM) runPrefetch();
  else if (alarm.name === POMODORO_ALARM) void advancePomodoro();
});

// Deliberately not an `async` listener: Chrome keeps the response channel open
// only for a literal `true`, and an async listener returns a Promise instead —
// the sender would get "message port closed before a response was received".
// Nothing here answers, so the handlers are started and the listener returns.
chrome.runtime.onMessage.addListener((message: PomodoroMessage) => {
  if (message?.type === 'pomodoro/start') void startPomodoro();
  else if (message?.type === 'pomodoro/reset') void resetPomodoro();
  // A ping asks for nothing except that the rehydration run. Waking a cold
  // worker would run it at module scope anyway, but a worker that is already
  // awake does not re-run module scope — and a frozen timer is just as frozen
  // either way — so it is called explicitly rather than left to that side
  // effect. It bumps no command counter: this is not a user command.
  else if (message?.type === 'pomodoro/ping') void rehydratePomodoro();
});

// Every cold start, whatever woke the worker — not only startup and install.
// A worker torn down between `writePomodoroState` and `chrome.alarms.create`
// leaves a running session with nothing to advance it, and waiting for the next
// browser restart to notice would leave the timer frozen for the rest of the
// day. This runs alongside whichever event did the waking, including the
// Pomodoro alarm itself; `advancePomodoro`'s deadline check and epoch swap are
// what make that duplicate harmless.
void rehydratePomodoro();
