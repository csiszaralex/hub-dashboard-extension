import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from './test/chromeStub';
import { pomodoroState } from './test/pomodoroState';
import type { PomodoroMessage, PomodoroState } from './utils/pomodoroState';

// Imported per test: importing the module is what registers the listeners, so
// each test needs a fresh copy wired to its own stub.
const loadBackground = async () => await import('./background');

const PREFETCH_ALARM = 'prefetch-background';
const PREFETCH_KEY = 'prefetched_bg';
const POMODORO_ALARM = 'pomodoro-phase';
const POMODORO_STATE_KEY = 'pomodoro_state';
const MINUTE = 60_000;

/** What a tab does. Nothing answers, so the reply callback only clears lastError. */
const send = (message: PomodoroMessage) => {
  chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
};

/** Drops the Pomodoro alarm, the way Chrome does on an extension reload. */
const loseAlarm = () =>
  new Promise<void>((resolve) => chrome.alarms.clear(POMODORO_ALARM, () => resolve()));

/**
 * Moves the stored deadline into the past, leaving everything else alone.
 *
 * A phase only elapses when its deadline arrives, and no test can wait out a
 * real 25-minute one — so a transition has to be set up rather than merely
 * announced with `fireAlarm`. Writing the deadline is closer to what actually
 * happens than faking the clock, and it leaves `settle()`'s real `setTimeout`
 * alone.
 */
const expirePhase = async () => {
  const raw = (globalThis as unknown as { chrome: typeof chrome }).chrome;
  const state = await new Promise<PomodoroState>((resolve) => {
    raw.storage.local.get([POMODORO_STATE_KEY], (items) =>
      resolve(items[POMODORO_STATE_KEY] as PomodoroState),
    );
  });
  await new Promise<void>((resolve) => {
    raw.storage.local.set({ [POMODORO_STATE_KEY]: { ...state, endsAt: Date.now() - 1 } }, () =>
      resolve(),
    );
  });
};

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

const stubFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/background')
      ? new Response(
          JSON.stringify({
            url: 'https://images.unsplash.com/tomorrow',
            location: null,
            photographer: 'Tomorrow',
            photographerUrl: '',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      : new Response(new Blob(['bytes'], { type: 'image/jpeg' })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** Lets every queued callback (and the promises they start) run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('background service worker', () => {
  it('schedules a daily prefetch alarm on install', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();

    chromeStub.fireInstalled('install');
    await settle();

    expect(chromeStub.scheduledAlarms()).toEqual([
      expect.objectContaining({ name: PREFETCH_ALARM, periodInMinutes: 24 * 60 }),
    ]);
  });

  it('leaves the existing alarm alone on browser startup', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    // Re-creating the alarm here would restart its 24 h clock, so a browser
    // restarted every day would never reach the prefetch at all.
    chromeStub.fireStartup();
    await settle();

    expect(chromeStub.createdAlarms()).toHaveLength(1);
  });

  // Deliberately not named "recreates the alarm when it went missing": with no
  // alarm scheduled, the gated and ungated versions of `scheduleAlarm` behave
  // identically, so this cannot discriminate between them. What it does cover is
  // that the startup path is wired up at all and schedules the right alarm — the
  // test above is the one that pins the gate.
  it('schedules the alarm on browser startup when none is scheduled yet', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();

    chromeStub.fireStartup();
    await settle();

    expect(chromeStub.scheduledAlarms()).toEqual([
      expect.objectContaining({ name: PREFETCH_ALARM, periodInMinutes: 24 * 60 }),
    ]);
  });

  it('prefetches tomorrow when the alarm fires', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest', backgroundSource: 'unsplash' });
    stubFetch();
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    chromeStub.fireAlarm(PREFETCH_ALARM);
    await settle();

    expect(chromeStub.readLocal(PREFETCH_KEY)).toEqual({
      date: tomorrow(),
      query: 'forest',
      data: {
        url: 'https://images.unsplash.com/tomorrow',
        location: null,
        photographer: 'Tomorrow',
        photographerUrl: '',
      },
    });
  });

  it('prefetches with the default query when the settings were never saved', async () => {
    // Nothing seeded on purpose: `unsplashQuery` only reaches storage when the
    // popup is saved, so on a fresh install — most installs — the key is simply
    // absent. Falling back to anything other than the page's own default makes
    // the packet unadoptable and the whole download wasted.
    const chromeStub = installChromeStub();
    const fetchMock = stubFetch();
    const { DEFAULT_UNSPLASH_QUERY } = await import('./utils/api');
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    chromeStub.fireAlarm(PREFETCH_ALARM);
    await settle();

    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.searchParams.get('tags')).toBe(DEFAULT_UNSPLASH_QUERY);
    expect(chromeStub.readLocal(PREFETCH_KEY)).toMatchObject({ query: DEFAULT_UNSPLASH_QUERY });
  });

  it('makes no request when the user supplied their own background', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ backgroundSource: 'custom' });
    const fetchMock = stubFetch();
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    chromeStub.fireAlarm(PREFETCH_ALARM);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(chromeStub.readLocal(PREFETCH_KEY)).toBeUndefined();
  });

  it('routes only its own alarm to the prefetch', async () => {
    // Both alarms land on the same listener, so a name check that was missing
    // or too loose would run a prefetch every time a Pomodoro phase ended.
    const chromeStub = installChromeStub();
    const fetchMock = stubFetch();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    await expirePhase();

    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops image caches left by an older format on update', async () => {
    const chromeStub = installChromeStub();
    await caches.open('hub-background-v0');
    const { IMAGE_CACHE_NAME } = await import('./utils/imageCache');
    await caches.open(IMAGE_CACHE_NAME);
    await loadBackground();

    chromeStub.fireInstalled('update');
    await settle();

    expect(await caches.has('hub-background-v0')).toBe(false);
    expect(await caches.has(IMAGE_CACHE_NAME)).toBe(true);
  });
});

describe('background service worker — Pomodoro', () => {
  const readState = (chromeStub: ReturnType<typeof installChromeStub>) =>
    chromeStub.readLocal(POMODORO_STATE_KEY) as PomodoroState | undefined;

  const scheduledPomodoro = (chromeStub: ReturnType<typeof installChromeStub>) =>
    chromeStub.scheduledAlarms().find((alarm) => alarm.name === POMODORO_ALARM);

  it('starts a work phase of the configured length on a start message', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ pomodoroWorkMinutes: 30, pomodoroBreakMinutes: 7 });
    await loadBackground();
    const before = Date.now();

    send({ type: 'pomodoro/start' });
    await settle();

    const state = readState(chromeStub);
    expect(state).toMatchObject({ phase: 'work', running: true });
    expect(state?.endsAt).toBeGreaterThanOrEqual(before + 30 * MINUTE);
    expect(scheduledPomodoro(chromeStub)?.scheduledTime).toBe(state?.endsAt);
  });

  it('clamps a corrupt phase length rather than scheduling a zero-length phase', async () => {
    const chromeStub = installChromeStub();
    // Sync storage is not only written by the popup, so the worker cannot
    // assume the value it reads has already been through `useSettings.merge`.
    chromeStub.seedSync({ pomodoroWorkMinutes: 0 });
    await loadBackground();
    const before = Date.now();

    send({ type: 'pomodoro/start' });
    await settle();

    expect(readState(chromeStub)?.endsAt).toBeGreaterThanOrEqual(before + MINUTE);
  });

  it('writes the state before it schedules the alarm', async () => {
    // The kill-safety ordering, asserted rather than trusted: an MV3 worker can
    // be torn down between the two steps, and an alarm for a state that was
    // never written is a timer that dies silently — `advancePomodoro` reads an
    // idle state and returns. A state with no alarm merely runs down to 00:00
    // in the open tabs, which the user can see and fix.
    const chromeStub = installChromeStub();
    await loadBackground();

    const alarms = chrome.alarms as unknown as { create: (...args: unknown[]) => void };
    const create = alarms.create.bind(alarms);
    const stateAtSchedule: unknown[] = [];
    alarms.create = (...args: unknown[]) => {
      stateAtSchedule.push(readState(chromeStub));
      create(...args);
    };

    send({ type: 'pomodoro/start' });
    await settle();

    expect(stateAtSchedule).toEqual([expect.objectContaining({ phase: 'work', running: true })]);
  });

  it('advances to the break phase and reschedules when the alarm fires', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 });
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    await expirePhase();
    const before = Date.now();

    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    const state = readState(chromeStub);
    expect(state).toMatchObject({ phase: 'break', running: true });
    // The break is measured from now, not from the deadline that just passed,
    // so a machine that was asleep when the alarm was due still gets a full one.
    expect(state?.endsAt).toBeGreaterThanOrEqual(before + 5 * MINUTE);
    expect(scheduledPomodoro(chromeStub)?.scheduledTime).toBe(state?.endsAt);
  });

  it('goes back to work after the break', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();

    await expirePhase();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();
    await expirePhase();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(readState(chromeStub)).toMatchObject({ phase: 'work', running: true });
  });

  // The property this whole task exists for. The old timer lived in the hook,
  // so every open tab ran its own interval and raised its own notification.
  it('raises exactly one notification per transition, with no tab open at all', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();

    await expirePhase();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications()).toHaveLength(1);
    expect(chromeStub.sentNotifications()[0]).toMatchObject({
      type: 'basic',
      title: 'Hub',
      message: 'Break time — step away.',
    });
  });

  it('announces the phase that has just begun, not the one that ended', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();

    await expirePhase();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();
    await expirePhase();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications().map((n) => n.message)).toEqual([
      'Break time — step away.',
      'Focus time — back to it.',
    ]);
  });

  it('notifies in the saved language', async () => {
    // The worker cannot go through `i18n/i18n.ts` (it would drag React in, and
    // applies the saved language a storage round-trip late), so the language it
    // uses is read alongside the phase lengths. If that read were dropped the
    // notification would silently fall back to the browser's language.
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ language: 'hu' });
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();

    await expirePhase();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications()[0]).toMatchObject({
      message: 'Szünet — állj fel egy kicsit.',
    });
  });

  it('does not throw when chrome.notifications is unavailable', async () => {
    // Mirrors a manifest missing the `notifications` permission: in a real
    // browser the namespace is simply absent, not a stub that always answers.
    // Without the guard `advancePomodoro` rejects, which Vitest reports as an
    // unhandled rejection and fails this test — the transition itself is
    // already persisted by then, so asserting on the state alone would not
    // notice.
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    await expirePhase();
    delete (globalThis as unknown as { chrome: { notifications?: unknown } }).chrome.notifications;

    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(readState(chromeStub)).toMatchObject({ phase: 'break', running: true });
  });

  it('clears the state and the alarm on a reset message', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();

    send({ type: 'pomodoro/reset' });
    await settle();

    // Full equality, not a subset: the epoch must have been bumped exactly twice
    // — once by the Start and once by the Reset — since that bump is what
    // invalidates a transition already in flight. A third bump would mean a
    // transition wrote after the Reset.
    expect(readState(chromeStub)).toEqual({
      phase: 'work',
      endsAt: null,
      running: false,
      epoch: 2,
    });
    expect(scheduledPomodoro(chromeStub)).toBeUndefined();
  });

  it('does nothing when an alarm outlives the reset that raced it', async () => {
    // `alarms.clear` is asynchronous and the alarm may already be queued, so a
    // transition can arrive for a session the user has just ended. The state,
    // not the alarm, is the authority — otherwise Reset would be followed by a
    // notification and a fresh phase.
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();

    const { IDLE_POMODORO, writePomodoroState } = await import('./utils/pomodoroState');
    await writePomodoroState(IDLE_POMODORO);
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(readState(chromeStub)).toEqual(IDLE_POMODORO);
    expect(chromeStub.sentNotifications()).toHaveLength(0);
  });

  it('puts the alarm back on any cold start, whatever woke the worker', async () => {
    // A worker torn down between the state write and `alarms.create` leaves a
    // running session with nothing to advance it. Waiting for the next browser
    // restart to notice would freeze the timer for the rest of the day, so this
    // runs at module scope — no event is fired here at all.
    const chromeStub = installChromeStub();
    const endsAt = Date.now() + 10 * MINUTE;
    chromeStub.seedLocal({
      [POMODORO_STATE_KEY]: pomodoroState({ phase: 'work', endsAt, running: true }),
    });

    await loadBackground();
    await settle();

    expect(scheduledPomodoro(chromeStub)?.scheduledTime).toBe(endsAt);
  });

  it('puts the alarm back when browser startup finds it missing', async () => {
    const chromeStub = installChromeStub();
    const endsAt = Date.now() + 10 * MINUTE;
    chromeStub.seedLocal({
      [POMODORO_STATE_KEY]: pomodoroState({ phase: 'break', endsAt, running: true }),
    });
    await loadBackground();
    await settle();
    // Losing the alarm *after* the worker started is what makes this about the
    // startup path rather than the cold-start one above — otherwise the module
    // scope has already put it back and this would pass with `onStartup`
    // unwired entirely.
    await loseAlarm();
    expect(scheduledPomodoro(chromeStub)).toBeUndefined();

    chromeStub.fireStartup();
    await settle();

    expect(scheduledPomodoro(chromeStub)?.scheduledTime).toBe(endsAt);
    // The stored deadline is the source of truth: a restart must not hand the
    // user a fresh full-length phase.
    expect(readState(chromeStub)).toEqual({ phase: 'break', endsAt, running: true, epoch: 0 });
    expect(chromeStub.sentNotifications()).toHaveLength(0);
  });

  it('puts the alarm back after an extension update too', async () => {
    const chromeStub = installChromeStub();
    const endsAt = Date.now() + 10 * MINUTE;
    chromeStub.seedLocal({
      [POMODORO_STATE_KEY]: pomodoroState({ phase: 'work', endsAt, running: true }),
    });
    await loadBackground();
    await settle();
    await loseAlarm();

    chromeStub.fireInstalled('update');
    await settle();

    expect(scheduledPomodoro(chromeStub)?.scheduledTime).toBe(endsAt);
  });

  it('advances immediately when the deadline passed while the extension was gone', async () => {
    // Scheduling an alarm into the past would leave the phase to Chrome's
    // next-opportunity delivery; advancing here is deterministic, and it is the
    // same thing `advancePomodoro` does for an alarm that arrives late.
    //
    // No event is fired: the cold-start rehydration is what does this, and a
    // `fireStartup()` here would be inert theatre — the module scope has
    // already advanced the phase by the time it could run. The startup wiring
    // is pinned by 'puts the alarm back when browser startup finds it missing'.
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 });
    chromeStub.seedLocal({
      [POMODORO_STATE_KEY]: { phase: 'work', endsAt: Date.now() - 3 * MINUTE, running: true },
    });
    const before = Date.now();

    await loadBackground();
    await settle();

    const state = readState(chromeStub);
    expect(state).toMatchObject({ phase: 'break', running: true });
    expect(state?.endsAt).toBeGreaterThanOrEqual(before + 5 * MINUTE);
    expect(scheduledPomodoro(chromeStub)?.scheduledTime).toBe(state?.endsAt);
    expect(chromeStub.sentNotifications()).toHaveLength(1);
  });

  it('restores nothing when there was no session to restore', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedLocal({
      [POMODORO_STATE_KEY]: { phase: 'work', endsAt: null, running: false },
    });
    await loadBackground();

    chromeStub.fireStartup();
    await settle();

    expect(scheduledPomodoro(chromeStub)).toBeUndefined();
    expect(chromeStub.sentNotifications()).toHaveLength(0);
  });

  it('advances once when a restart delivers the overdue alarm after rehydrating', async () => {
    // Chrome keeps pending alarms across a browser restart and delivers an
    // overdue one shortly after startup — the same behaviour the prefetch alarm
    // relies on. So a delivered alarm lands on a phase the rehydration has
    // already moved on from.
    //
    // Deliberately NOT the concurrent case, despite the setup looking like it:
    // the cold-start rehydration completes during `await loadBackground()`, so
    // both calls below arrive late and stop at the deadline guard. The genuinely
    // same-round interleaving is covered by 'advances once when two overdue
    // alarms are delivered in the same round'.
    const chromeStub = installChromeStub();
    const endsAt = Date.now() - 3 * MINUTE;
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: { phase: 'work', endsAt, running: true } });
    chromeStub.seedAlarm(POMODORO_ALARM, endsAt);
    await loadBackground();

    chromeStub.fireStartup();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications()).toHaveLength(1);
    expect(readState(chromeStub)).toMatchObject({ phase: 'break', running: true });
  });

  it('advances once when the overdue alarm arrives after the rehydration finished', async () => {
    // The sequential half of the same race: the rehydration has already
    // completed and written the next phase by the time Chrome delivers the
    // alarm. Nothing is in flight to compare against, so the only thing that can
    // stop a second advance is noticing the deadline has not arrived yet.
    const chromeStub = installChromeStub();
    const endsAt = Date.now() - 3 * MINUTE;
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: { phase: 'work', endsAt, running: true } });
    chromeStub.seedAlarm(POMODORO_ALARM, endsAt);
    await loadBackground();

    chromeStub.fireStartup();
    await settle();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications()).toHaveLength(1);
    expect(readState(chromeStub)).toMatchObject({ phase: 'break', running: true });
  });

  it('advances once when two overdue alarms are delivered in the same round', async () => {
    // Both listeners run in one synchronous burst, so both state reads snapshot
    // the expired phase before either write lands — and so do both
    // compare-and-swap re-reads, which is why the stored epoch cannot see this
    // on its own. On a real browser restart the module scope, `onStartup` and
    // the delivered alarm all start within microseconds of each other, so this
    // ordering is a coin flip rather than a sliver.
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    await expirePhase();

    chromeStub.fireAlarm(POMODORO_ALARM);
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications()).toHaveLength(1);
    expect(readState(chromeStub)).toMatchObject({ phase: 'break', running: true });
    expect(chromeStub.createdAlarms().filter((a) => a.name === POMODORO_ALARM)).toHaveLength(2);
  });

  it('abandons a transition when a Reset is issued inside the compare-and-swap window', async () => {
    // Hooking the settings read — the one thing `advancePomodoro` does between
    // its two state reads — drops the Reset into the middle of the transition.
    //
    // The exact ordering, since a wrong trace in a concurrency test is worse
    // than none: `realGet` queues the settings callback first, then `send`
    // queues the message, so the Reset is invoked *before* the swap's re-read is
    // even issued. Resolving the settings promise costs one more microtask hop
    // than the callback itself, which is what puts the message ahead of it.
    // The epoch is blind either way — the Reset has bumped the counter but not
    // yet written, so the re-read snapshots the pre-Reset epoch and the swap
    // passes. Only the synchronous counter sees it.
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    await expirePhase();

    const syncApi = chrome.storage.sync as unknown as { get: (...args: unknown[]) => void };
    const realGet = syncApi.get.bind(chrome.storage.sync);
    let hooked = false;
    syncApi.get = (...args: unknown[]) => {
      realGet(...args);
      if (hooked) return;
      hooked = true;
      send({ type: 'pomodoro/reset' });
    };

    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications()).toHaveLength(0);
    expect(readState(chromeStub)).toMatchObject({ running: false, endsAt: null });
    expect(scheduledPomodoro(chromeStub)).toBeUndefined();
  });

  it('does not announce a phase that a Reset cancelled while it was being written', async () => {
    // The last window: the Reset is invoked after the transition has issued its
    // write but before that write's callback resumes it. The state ends up the
    // Reset's, as designed — but the cancelled phase must not still be
    // announced. Provoking it needs the hook below; ordinary event ordering
    // cannot place a message inside a single storage write.
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    await expirePhase();

    const localApi = chrome.storage.local as unknown as { set: (...args: unknown[]) => void };
    const realSet = localApi.set.bind(chrome.storage.local);
    let hooked = false;
    localApi.set = (...args: unknown[]) => {
      // Queued before `realSet`'s callback, so the Reset runs while the
      // transition is still suspended on its own write.
      if (!hooked) {
        hooked = true;
        send({ type: 'pomodoro/reset' });
      }
      realSet(...args);
    };

    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    expect(chromeStub.sentNotifications()).toHaveLength(0);
    expect(readState(chromeStub)).toMatchObject({ running: false, endsAt: null });
  });

  it('lets a Reset that lands mid-transition win', async () => {
    // `advancePomodoro` reads the state and then awaits before writing. A Reset
    // arriving in that window used to be overwritten, handing the user back a
    // running session with a fresh alarm and a notification for a phase they had
    // just cancelled.
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    await expirePhase();

    chromeStub.fireAlarm(POMODORO_ALARM);
    send({ type: 'pomodoro/reset' });
    await settle();

    // Full equality, not a subset: the epoch must have been bumped exactly twice
    // — once by the Start and once by the Reset — since that bump is what
    // invalidates a transition already in flight. A third bump would mean a
    // transition wrote after the Reset.
    expect(readState(chromeStub)).toEqual({
      phase: 'work',
      endsAt: null,
      running: false,
      epoch: 2,
    });
    expect(scheduledPomodoro(chromeStub)).toBeUndefined();
    expect(chromeStub.sentNotifications()).toHaveLength(0);
  });

  it('rehydrates a lost alarm when a tab pings on open', async () => {
    // A worker that is already awake does not re-run its module scope, so the
    // cold-start rehydration cannot be relied on here — the ping has to do it.
    const chromeStub = installChromeStub();
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();
    const endsAt = scheduledPomodoro(chromeStub)?.scheduledTime;
    await loseAlarm();

    send({ type: 'pomodoro/ping' });
    await settle();

    expect(scheduledPomodoro(chromeStub)?.scheduledTime).toBe(endsAt);
    // Asks for nothing else: no phase change, no announcement, no new session.
    expect(readState(chromeStub)).toMatchObject({ phase: 'work', running: true, epoch: 1 });
    expect(chromeStub.sentNotifications()).toHaveLength(0);
  });

  it('ignores a message that is not one of its own', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();

    chrome.runtime.sendMessage({ type: 'something/else' }, () => void chrome.runtime.lastError);
    await settle();

    expect(readState(chromeStub)).toBeUndefined();
    expect(chromeStub.scheduledAlarms()).toHaveLength(0);
  });

  it('does not answer the message, so it must not hold the response channel open', async () => {
    // An `async` onMessage listener returns a Promise; Chrome keeps the channel
    // open only for a literal `true` and otherwise reports "message port
    // closed" to the sender. Nothing here answers, so that is the correct — and
    // harmless — outcome, provided the page reads `lastError` to acknowledge it.
    const chromeStub = installChromeStub();
    await loadBackground();

    const errors: (string | undefined)[] = [];
    chrome.runtime.sendMessage({ type: 'pomodoro/start' }, () => {
      errors.push(chrome.runtime.lastError?.message);
    });
    await settle();

    expect(errors).toEqual(['The message port closed before a response was received.']);
    expect(chromeStub.sentMessages()).toEqual([{ type: 'pomodoro/start' }]);
    expect(readState(chromeStub)).toMatchObject({ running: true });
  });
});

/**
 * Guards the one thing the worker cannot discover for itself.
 *
 * The page picks up a new `src/i18n/locales/*.json` automatically —
 * `AVAILABLE_LANGUAGES` is read from that directory at build time — but the
 * worker cannot use `i18n/i18n.ts` (it would drag React into a worker Chrome
 * cold-starts on every alarm), so its `LOCALES` map is maintained by hand. A
 * missing entry has no symptom the author would notice: notifications just
 * quietly come out in English while the rest of the UI is translated.
 *
 * The set of locales is taken from the directory itself, never from
 * `AVAILABLE_LANGUAGES`, `LOCALES` or any other list — one built by the same
 * machinery this is checking would inherit the very blind spot it exists to
 * cover. `import.meta.glob` and not `node:fs`, because `tsconfig.app.json`
 * deliberately keeps `node` out of its `types`, and widening that so one test
 * can call `readdirSync` would hand Node globals to every browser-extension
 * module in `src`. The glob is expanded from the real directory on each run,
 * so a locale file added without a `LOCALES` entry turns up here immediately.
 */
const localeModules = import.meta.glob<{
  pomodoro: { notificationTitle: string; breakStarted: string };
}>('./i18n/locales/*.json', { eager: true, import: 'default' });

const localeFiles = Object.keys(localeModules)
  .map((path) => path.slice(path.lastIndexOf('/') + 1))
  .sort();

describe('background service worker — notification locale parity', () => {
  it('finds locale files to check', () => {
    // If the directory moves, every case below would vacuously pass.
    expect(localeFiles.length).toBeGreaterThan(0);
  });

  it.each(localeFiles)('announces a phase change in %s', async (file) => {
    const language = file.replace('.json', '');
    const expected = localeModules[`./i18n/locales/${file}`].pomodoro;

    const chromeStub = installChromeStub();
    chromeStub.seedSync({ language });
    await loadBackground();
    send({ type: 'pomodoro/start' });
    await settle();

    await expirePhase();
    chromeStub.fireAlarm(POMODORO_ALARM);
    await settle();

    const hint =
      `No entry for "${file}" in the LOCALES map in src/background.ts, so a user ` +
      `with language "${language}" gets the fallback locale's notifications while ` +
      `the rest of their UI is translated. Fix: import ./i18n/locales/${file} ` +
      `there and add "${language}: ${language}.pomodoro" to LOCALES.`;

    const sent = chromeStub.sentNotifications()[0];
    expect(sent?.message, hint).toBe(expected.breakStarted);
    expect(sent?.title, hint).toBe(expected.notificationTitle);
  });
});
