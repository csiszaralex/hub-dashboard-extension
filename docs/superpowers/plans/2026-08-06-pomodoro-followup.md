# Pomodoro Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four things the author found when using the Pomodoro timer in Chrome: it is per-tab rather than shared, it is positioned awkwardly, its settings inputs cannot be typed into cleanly, and nothing signals a phase change except a notification that fires once per open tab.

**Architecture:** The timer's state moves out of React and into `chrome.storage.local`, with the **service worker** owning phase transitions via `chrome.alarms`. Tabs become pure renderers: they read state, tick locally only to recompute the displayed remainder, and send messages to start or reset. That makes every tab agree, makes exactly one notification fire per transition, and keeps the timer running when no tab is open.

**Tech Stack:** React 19, Vite 7 + CRXJS, Manifest V3, Tailwind CSS 4, TypeScript, Vitest + happy-dom.

## Global Constraints

- Conventional Commits, scopes `api | extension | shared | repo | release | ci`.
- No JSX string literals — `eslint-plugin-i18next` fails the build. Every user-visible string in BOTH `src/i18n/locales/en.json` and `hu.json`; `src/i18n/validate.ts` fails typecheck if their key structures diverge.
- **`localStorage` does not exist in a service worker.** Anything the worker persists goes in `chrome.storage.local`. Any module the worker imports, transitively, must be free of `window`, `document` and `localStorage`.
- Settings flow through `useSettings` in page code. The service worker reads `chrome.storage.sync` directly — the documented exception.
- No new `manifest.json` permissions are needed: `alarms` and `notifications` are already declared. If you believe one is missing, stop and say so rather than adding it — a permission change requires a `privacy-policy.md` update and a `Effective Date` bump.
- Run `pnpm nx run-many -t typecheck lint test build` from the repo root before finishing each task.
- LF line endings. Python's `write_text` converts to CRLF on Windows — use `write_bytes`. Verify every file you touch.
- Test doubles must model what the real API enforces, not just its happy path. This project has shipped two real-browser bugs past a green suite because a stub was permissive, and has had five tests whose names promised more than they proved. A test that cannot fail must be deleted, not annotated.

## Current State

- `src/utils/pomodoro.ts` — `PomodoroPhase`, `nextPhase`, `phaseDurationMs`, `formatRemaining`, `clampPomodoroMinutes`. Pure, no React, already worker-safe.
- `src/hooks/usePomodoro.ts` — holds `phase`, `running`, `endsAtRef`, a 1s interval, and calls `notify()` itself. **All per-tab.**
- `src/components/PomodoroWidget.tsx` — `absolute bottom-48 left-8`, carries a long comment justifying that position.
- `src/components/CountdownWidget.tsx` — returns `null` when no target; positioned by `App.tsx`.
- `App.tsx` renders `{shouldShow ? <WhatsNewModal/> : showWidget('countdown') && <CountdownWidget/>}` inside `absolute top-10 left-1/2 -translate-x-1/2`, and `{showWidget('pomodoro') && <PomodoroWidget/>}` separately.
- `src/background.ts` — service worker; owns the `prefetch-background` alarm.
- `src/test/chromeStub.ts` — has `storage.sync`, `storage.local`, `alarms` (create/get/getAll, `fireAlarm`), `notifications` with `sentNotifications()`, `runtime.onInstalled`/`onStartup`.

---

### Task 1: Let the minute inputs be typed into

`Number('')` is `0`, so clearing a minutes field immediately writes `0` into state and the input redisplays `0` — typing `3` then yields `03`. The value is already clamped on submit, so this is purely an input-binding problem.

**Files:**
- Modify: `apps/extension/src/popup/PopupForm.tsx`
- Modify: `apps/extension/src/popup/PopupForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `PopupForm.test.tsx`:

```tsx
it('lets the focus length be cleared and retyped without a leading zero', async () => {
  const { PopupForm } = await import('./PopupForm');
  const onSave = vi.fn();
  render(<PopupForm initialSettings={{ ...baseSettings, pomodoroWorkMinutes: 25 }} onSave={onSave} />);

  fireEvent.click(screen.getByRole('button', { name: /focus/i }));
  const input = screen.getByLabelText(/focus length/i) as HTMLInputElement;

  fireEvent.change(input, { target: { value: '' } });
  expect(input.value).toBe('');

  fireEvent.change(input, { target: { value: '3' } });
  expect(input.value).toBe('3');
});
```

- [ ] **Step 2: Run it and watch it fail**

`cd apps/extension && pnpm vitest run src/popup/PopupForm.test.tsx`
Expected: FAIL — the field shows `0` after clearing, then `03`.

- [ ] **Step 3: Hold the raw string while editing**

Change `workMinutes` / `breakMinutes` state to `string`, initialised with `String(initialSettings.pomodoroWorkMinutes)`. Bind `value={workMinutes}` directly and set state from `e.target.value` unchanged. In `handleSubmit`, convert once: `pomodoroWorkMinutes: clampPomodoroMinutes(Number(workMinutes))`. `clampPomodoroMinutes` already maps `NaN` and `0` to the minimum, so an empty field saves as the minimum rather than zero.

- [ ] **Step 4: Confirm the submit path still clamps**

Run the whole popup suite. The existing clamp tests must still pass unchanged. If any needs editing, stop — that means behaviour changed.

- [ ] **Step 5: Verify and stop**

`pnpm nx run-many -t typecheck lint test` from the repo root. Do not commit.

---

### Task 2: Share one top-centre slot between the countdown and the timer

Both are "a number counting down". They should sit together, and the Pomodoro's current `bottom-48 left-8` still shares a column with the calendar, whose event list has no height cap.

**Files:**
- Modify: `apps/extension/src/App.tsx`
- Modify: `apps/extension/src/components/PomodoroWidget.tsx`

- [ ] **Step 1: Make the widget position-free**

Delete the `absolute bottom-48 left-8` classes **and the long positioning comment above the component** — it documents a decision that no longer exists. The root element keeps only its own appearance classes (`flex items-center gap-3 px-4 py-2.5 bg-black/40 …`). Positioning becomes the parent's job.

- [ ] **Step 2: Render both in one row**

In `App.tsx`, replace the top-centre block with:

```tsx
        <div className='absolute top-10 left-1/2 -translate-x-1/2 flex items-start gap-4'>
          {shouldShow ? (
            <WhatsNewModal version={currentVersion} onClose={dismiss} />
          ) : (
            <>
              {showWidget('countdown') && <CountdownWidget />}
              {showWidget('pomodoro') && <PomodoroWidget />}
            </>
          )}
        </div>
```

and remove the separate `{showWidget('pomodoro') && <PomodoroWidget />}` from further down. `CountdownWidget` already returns `null` with no target and `PomodoroWidget` returns `null` until settings load, so the row collapses to whatever is actually present — one centred item, or two side by side.

- [ ] **Step 3: Give the timer the countdown's visual weight**

The author asked for it to be bigger. `CountdownWidget` uses `text-5xl` digits with `px-10 py-5` padding; the Pomodoro pill uses `text-2xl` with `px-4 py-2.5`. Raise the timer toward the countdown's scale so the two read as siblings rather than one being an afterthought. Keep the label/digits/buttons structure.

- [ ] **Step 4: Check for collisions at narrow widths**

The row is centred and grows in both directions. Confirm that with both widgets present it does not reach the calendar (`top-8 left-8`) or weather (`top-8 right-8`) pills at a realistic minimum window width. State the width you reasoned about. If it does collide, say so rather than shrinking the widget back down.

- [ ] **Step 5: Verify and stop**

`pnpm nx run-many -t typecheck lint test build`. Do not commit.

---

### Task 3: Move the timer into the service worker

This is the substantial one. State moves to `chrome.storage.local`; the worker owns transitions and notifications; tabs render.

**Files:**
- Create: `apps/extension/src/utils/pomodoroState.ts`
- Create: `apps/extension/src/utils/pomodoroState.test.ts`
- Modify: `apps/extension/src/background.ts`
- Modify: `apps/extension/src/background.test.ts`
- Modify: `apps/extension/src/hooks/usePomodoro.ts`
- Modify: `apps/extension/src/hooks/usePomodoro.test.ts`
- Modify: `apps/extension/src/test/chromeStub.ts`

**Interfaces:**

```ts
// utils/pomodoroState.ts — worker-safe, no React, no localStorage
export const POMODORO_STATE_KEY = 'pomodoro_state';
export const POMODORO_ALARM = 'pomodoro-phase';

export interface PomodoroState {
  phase: PomodoroPhase;
  endsAt: number | null;   // epoch ms; null when idle
  running: boolean;
}

export const IDLE_POMODORO: PomodoroState;
export const readPomodoroState: () => Promise<PomodoroState>;
export const writePomodoroState: (state: PomodoroState) => Promise<void>;

// Messages the page sends to the worker
export type PomodoroMessage = { type: 'pomodoro/start' } | { type: 'pomodoro/reset' };
```

- [ ] **Step 1: Extend the chrome stub — honestly — before anything else**

`chromeStub` needs `runtime.sendMessage` / `runtime.onMessage` and `alarms.clear`. Model what Chrome actually does:
- `onMessage` listeners receive `(message, sender, sendResponse)`; delivery is asynchronous.
- `alarms.clear(name, cb)` reports whether an alarm was actually removed.
- An alarm created with `when` in the past fires at the next opportunity rather than being dropped.

Expose `sentMessages()` and reuse the existing `fireAlarm`. Run the suite: it must stay green, since nothing uses these yet.

- [ ] **Step 2: Write the state module with failing tests first**

`readPomodoroState` returns `IDLE_POMODORO` when nothing is stored and when the stored value is malformed (not an object, missing `phase`, `endsAt` not a number or null). Cover each. `writePomodoroState` round-trips through `chrome.storage.local`.

- [ ] **Step 3: Move transitions into the worker**

In `background.ts`, add alongside the existing prefetch wiring:

```ts
const startPomodoro = async () => {
  const settings = await readPomodoroSettings();          // sync storage, clamped
  const endsAt = Date.now() + phaseDurationMs('work', settings.work, settings.break);
  await writePomodoroState({ phase: 'work', endsAt, running: true });
  chrome.alarms.create(POMODORO_ALARM, { when: endsAt });
};

const resetPomodoro = async () => {
  await writePomodoroState(IDLE_POMODORO);
  chrome.alarms.clear(POMODORO_ALARM);
};

const advancePomodoro = async () => {
  const state = await readPomodoroState();
  if (!state.running) return;                              // a reset raced the alarm

  const settings = await readPomodoroSettings();
  const upcoming = nextPhase(state.phase);
  const endsAt = Date.now() + phaseDurationMs(upcoming, settings.work, settings.break);

  await writePomodoroState({ phase: upcoming, endsAt, running: true });
  chrome.alarms.create(POMODORO_ALARM, { when: endsAt });
  notify(upcoming);                                        // exactly one, wherever tabs are
};
```

Wire `chrome.runtime.onMessage` to `startPomodoro` / `resetPomodoro`, and extend the existing `chrome.alarms.onAlarm` listener to route `POMODORO_ALARM` to `advancePomodoro`. Move `notify` out of `usePomodoro.ts` and into the worker — including its defensive guard.

**Order matters, as it did for the prefetch:** write the state *before* creating the alarm, so a worker torn down in between leaves a state nobody will advance rather than an alarm for a state that does not exist. Say in your report why the order you chose is the safe one.

- [ ] **Step 4: Turn the hook into a renderer**

`usePomodoro` keeps its public shape — `{ phase, running, remainingMs, ready, start, reset }` — so `PomodoroWidget` needs no change. Inside:
- read `PomodoroState` from `chrome.storage.local` and subscribe to `chrome.storage.onChanged` for area `'local'`;
- derive `remainingMs` from `endsAt - Date.now()`, ticking a local 1s interval **only for display** while `running`;
- `start()` and `reset()` send messages; they no longer mutate anything locally;
- delete `notify`, `endsAtRef`, `phaseRef` and the transition logic — the worker owns all of it.

When idle, `remainingMs` shows the configured work length, as now.

- [ ] **Step 5: Prove the two properties that motivated this task**

Two tests that would have caught the reported problems:
- **Two hook instances agree.** Render `usePomodoro` twice, drive a state change through `chrome.storage.local`, assert both report the same `phase` and a `remainingMs` within a second of each other. This must fail against the old per-tab implementation.
- **Exactly one notification per transition.** Fire the alarm once in the worker tests and assert `sentNotifications()` has length 1 — and, with two hooks mounted, still 1.

- [ ] **Step 6: Verify and stop**

`pnpm nx run-many -t typecheck lint test build`. Do not commit.

---

### Task 4: Signal the phase change beyond the notification

**Files:**
- Modify: `apps/extension/src/components/PomodoroWidget.tsx`
- Create: `apps/extension/src/hooks/useDocumentTitle.ts` + test
- Modify: `apps/extension/src/i18n/locales/en.json`, `hu.json`

- [ ] **Step 1: Write the failing test for the title hook**

`useDocumentTitle(title: string | null)` sets `document.title` and restores the previous title when it unmounts or receives `null`. Cover: sets, restores on unmount, restores on `null`, and does not clobber a title set by something else after it restored.

- [ ] **Step 2: Implement it**

Capture the original title once on mount in a ref; write on change; restore in cleanup.

- [ ] **Step 3: Drive it from the timer**

In `PomodoroWidget`, call it with `t('pomodoro.titleWork', { time })` / `t('pomodoro.titleBreak', { time })` while running, and `null` otherwise. Locale strings — add to both files:
- `en`: `"titleWork": "Hub — Focus {{time}}"`, `"titleBreak": "Hub — Break {{time}}"`
- `hu`: `"titleWork": "Hub — Fókusz {{time}}"`, `"titleBreak": "Hub — Szünet {{time}}"`

- [ ] **Step 4: Add the visible cue**

Break and focus must be distinguishable at a glance without reading the label — a colour shift on the pill is enough. Keep it within the existing visual language (the calendar's live-event indicator uses `indigo-400`; the weather widget uses `emerald`/`orange` accents). Do not add an animation that runs for 25 minutes.

- [ ] **Step 5: Verify and stop**

`pnpm nx run-many -t typecheck lint test build`. Do not commit.

---

## Known trade-off, recorded deliberately

The cycle repeats until Reset. With the worker owning it, that means notifications continue indefinitely even with no tab open — where previously closing every tab silently stopped the timer. This matches the current behaviour and was accepted by the author; a stop-after-N-cycles rule is a small follow-up if it proves annoying.

## Verification Checklist

- [ ] `pnpm nx run-many -t typecheck lint test build` green on all three projects.
- [ ] No `window`, `document` or `localStorage` in `background.ts` or anything it imports transitively — including `pomodoroState.ts`.
- [ ] `manifest.json` permissions unchanged: `storage`, `geolocation`, `identity`, `alarms`, `notifications`.
- [ ] Locale parity holds (a passing typecheck is the proof).
- [ ] Manual check in Chrome, which the suite cannot do: start the timer in one tab, open a second — both show the same remaining time; close every tab, reopen after a transition should have happened — the phase advanced and one notification arrived.
