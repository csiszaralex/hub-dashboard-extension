# Hub Feature Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nine user-facing features to the Hub new tab dashboard: background prefetch, a dimming slider, per-widget visibility, a multi-day forecast, custom background images, a resilient quote source (worker proxy + bundled fallback), keyboard access to the UI toggle, and a Pomodoro timer.

**Architecture:** Every feature follows the existing shape of this codebase. New user options become keys on `HubSettings` (one module-level store, read via `useSyncExternalStore`) and get a control in the popup. Derivation logic goes into pure modules under `src/utils/` so it can be tested without React. Background images continue to live in the Cache API, never in `localStorage`. The service worker gains a second job (prefetch) alongside its existing cache housekeeping.

**Tech Stack:** React 19, Vite 7 + CRXJS, Tailwind CSS 4, TypeScript, Vitest + happy-dom, Hono on Cloudflare Workers, Cloudflare KV.

## Global Constraints

- Conventional Commits, enforced by commitlint. Valid scopes: `api | extension | shared | repo | release | ci`.
- No JSX string literals — `eslint-plugin-i18next` fails the build. Every user-visible string goes in `src/i18n/locales/en.json` **and** `hu.json`. `src/i18n/validate.ts` fails typecheck if the two diverge.
- `localStorage` is **not available in a service worker.** Anything the service worker must persist goes in `chrome.storage.local`.
- Never store image bytes in `localStorage` — a 4K JPEG base64-encodes past the origin quota. Images go in the Cache API via `src/utils/imageCache.ts`.
- Never add a per-component `chrome.storage` read. All settings flow through `useSettings`.
- Any change to `permissions`, `host_permissions` or OAuth scopes in `apps/extension/manifest.json` MUST be mirrored in `apps/extension/privacy-policy.md` — that file is what the Chrome Web Store review reads.
- Hook tests must import the hook **inside** the test via `await import('./useX')`. `src/test/setup.ts` calls `vi.resetModules()` before each test, so a top-level import would share module state across tests.
- Run `pnpm nx run-many -t typecheck lint test` before every commit. It is cached; an unchanged tree takes ~40ms.
- Tailwind v4 — no `tailwind.config.js`. Use utility classes only.

## Shared Interfaces (locked across tasks)

These names are referenced by more than one task. Do not rename them.

```ts
// src/hooks/useSettings.ts — HubSettings gains these keys across Tasks 1, 2, 4, 9
backgroundDim: number;                        // 0–70, percent overlay opacity. Default 30. Task 1
hiddenWidgets: WidgetId[];                    // Default []. Task 2
backgroundSource: 'unsplash' | 'custom';      // Default 'unsplash'. Task 4
pomodoroWorkMinutes: number;                  // Default 25. Task 9
pomodoroBreakMinutes: number;                 // Default 5. Task 9

// src/widgets.ts — created in Task 2
export const WIDGET_IDS = ['clock','quote','weather','calendar','note','countdown','backgroundInfo','pomodoro'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export const isWidgetVisible: (hidden: readonly WidgetId[], id: WidgetId) => boolean;

// src/utils/api.ts — created in Task 5
export const BACKGROUND_ENDPOINT: string;     // 'https://hub-api.csiszaralex.workers.dev/api/background'
export const QUOTE_ENDPOINT: string;          // 'https://hub-api.csiszaralex.workers.dev/api/quote'
export const backgroundRequestUrl: (query: string) => string;

// src/utils/imageCache.ts — Task 4 adds
export const CUSTOM_IMAGE_KEY = 'hub://custom-background';
export const putCustomImage: (file: Blob) => Promise<boolean>;
export const hasCustomImage: () => Promise<boolean>;

// src/utils/prefetch.ts — created in Task 5
export interface PrefetchPacket { date: string; query: string; data: BackgroundData }
export const readPrefetch: () => Promise<PrefetchPacket | null>;
export const savePrefetch: (packet: PrefetchPacket) => Promise<void>;
export const clearPrefetch: () => Promise<void>;
export const prefetchBackground: (query: string, date: string) => Promise<boolean>;

// src/utils/forecast.ts — created in Task 3
export interface DailyForecast { date: string; max: number; min: number; code: number }
export const summarizeDaily: (daily: DailyBlock, days?: number) => DailyForecast[];

// src/utils/quoteFallback.ts — created in Task 7
export const FALLBACK_QUOTES: readonly { text: string; author: string }[];
export const pickFallbackQuote: (isoDate: string) => { text: string; author: string };

// packages/shared/src/index.ts — Task 6 adds
export interface QuoteData { text: string; author: string }
```

---

### Task 1: Background dimming slider

The overlay is hardcoded to `bg-black/30`, which makes `text-white/40`–`/50` unreadable on light photos. This task adds a user-controlled 0–70% dim. It also establishes the "new setting → popup control → consumed in App" pattern that Tasks 2, 4 and 9 reuse.

**Files:**
- Modify: `apps/extension/src/hooks/useSettings.ts` (add `backgroundDim` to `HubSettings` and `DEFAULT_SETTINGS`)
- Create: `apps/extension/src/utils/dim.ts`
- Create: `apps/extension/src/utils/dim.test.ts`
- Modify: `apps/extension/src/App.tsx:36-39` (overlay div)
- Modify: `apps/extension/src/popup/PopupForm.tsx` (slider on the `appearance` tab)
- Modify: `apps/extension/src/i18n/locales/en.json`, `hu.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `HubSettings.backgroundDim: number`; `clampDim(value: unknown): number` from `src/utils/dim.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/utils/dim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIM, clampDim, dimToOpacity } from './dim';

describe('clampDim', () => {
  it('keeps a value inside the allowed range', () => {
    expect(clampDim(45)).toBe(45);
  });

  it('clamps above the maximum so the photo never disappears', () => {
    expect(clampDim(95)).toBe(70);
  });

  it('clamps below zero', () => {
    expect(clampDim(-10)).toBe(0);
  });

  it('falls back to the default for a non-numeric value', () => {
    expect(clampDim('nonsense')).toBe(DEFAULT_DIM);
  });

  it('falls back to the default for NaN', () => {
    expect(clampDim(Number.NaN)).toBe(DEFAULT_DIM);
  });

  it('rounds to a whole percent', () => {
    expect(clampDim(33.7)).toBe(34);
  });
});

describe('dimToOpacity', () => {
  it('converts the percent into an inline opacity value', () => {
    expect(dimToOpacity(30)).toBe(0.3);
  });

  it('renders zero as fully transparent', () => {
    expect(dimToOpacity(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/utils/dim.test.ts`
Expected: FAIL with `Failed to resolve import "./dim"`

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/utils/dim.ts`:

```ts
/** Percent of black laid over the photo. Above ~70% the image is gone. */
export const DEFAULT_DIM = 30;
const MAX_DIM = 70;

export const clampDim = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DIM;
  return Math.min(MAX_DIM, Math.max(0, Math.round(n)));
};

/** The overlay uses an inline opacity so the value can be arbitrary, not a Tailwind step. */
export const dimToOpacity = (dim: number): number => clampDim(dim) / 100;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/utils/dim.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Add the setting**

In `apps/extension/src/hooks/useSettings.ts`, add `backgroundDim: number;` to the `HubSettings` interface (after `unsplashQuery`) and `backgroundDim: DEFAULT_DIM,` to `DEFAULT_SETTINGS`. Import `DEFAULT_DIM` from `../utils/dim`.

`KEYS` is derived from `DEFAULT_SETTINGS` via `Object.keys`, so no other change is needed there.

- [ ] **Step 6: Consume it in App**

In `apps/extension/src/App.tsx`, read the setting and drive the overlay. Replace the overlay div (currently lines 35-39) with:

```tsx
      <div
        className='absolute inset-0 bg-black pointer-events-none transition-opacity duration-1000'
        style={{ opacity: uiVisible ? dimToOpacity(settings.backgroundDim) : 0 }}
      />
```

Change line 17 from `const { isLoaded } = useSettings();` to `const { settings, isLoaded } = useSettings();` and add `import { dimToOpacity } from './utils/dim';`.

- [ ] **Step 7: Add the popup control**

In `apps/extension/src/popup/PopupForm.tsx`:

Add state next to the other `useState` calls:

```tsx
  const [dim, setDim] = useState(initialSettings.backgroundDim);
```

Add `backgroundDim: dim,` to the object passed to `onSave` in `handleSubmit`.

Inside the `activeTab === 'appearance'` block, after the existing query `Field`, add:

```tsx
          <Field id='dim' label={t('popup.dim')} hint={t('popup.dimHint', { value: dim })}>
            <input
              id='dim'
              type='range'
              min={0}
              max={70}
              step={5}
              value={dim}
              onChange={(e) => setDim(Number(e.target.value))}
              className='w-full accent-white'
            />
          </Field>
```

The `appearance` block currently renders a single `Field`; wrap both in a `<div className='flex flex-col gap-3'>`.

- [ ] **Step 8: Add the locale strings**

`en.json`, under `popup`: `"dim": "Background dimming"`, `"dimHint": "{{value}}% — raise this if text is hard to read on bright photos."`

`hu.json`, under `popup`: `"dim": "Háttér sötétítése"`, `"dimHint": "{{value}}% — világos képeken emeld, ha nehéz olvasni a szöveget."`

- [ ] **Step 9: Verify the whole workspace**

Run: `pnpm nx run-many -t typecheck lint test`
Expected: all three projects pass.

- [ ] **Step 10: Commit**

```bash
git add apps/extension/src/utils/dim.ts apps/extension/src/utils/dim.test.ts apps/extension/src/hooks/useSettings.ts apps/extension/src/App.tsx apps/extension/src/popup/PopupForm.tsx apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json
git commit -m "feat(extension): add a background dimming slider

The overlay was fixed at 30% black, which left the dimmer text unreadable
on bright photos."
```

---

### Task 2: Per-widget visibility toggles

Nothing can currently be turned off. This adds a `widgets` tab to the popup with a checkbox per widget.

**Files:**
- Create: `apps/extension/src/widgets.ts`
- Create: `apps/extension/src/widgets.test.ts`
- Create: `apps/extension/src/popup/WidgetsSection.tsx`
- Modify: `apps/extension/src/hooks/useSettings.ts` (add `hiddenWidgets`)
- Modify: `apps/extension/src/popup/TabNav.tsx` (add the `widgets` tab)
- Modify: `apps/extension/src/popup/PopupForm.tsx`
- Modify: `apps/extension/src/App.tsx`
- Modify: `apps/extension/src/i18n/locales/en.json`, `hu.json`

**Interfaces:**
- Consumes: `HubSettings` from Task 1 (already extended).
- Produces: `WIDGET_IDS`, `type WidgetId`, `isWidgetVisible(hidden, id)` from `src/widgets.ts`. Task 9 adds `'pomodoro'` handling but the id is already in `WIDGET_IDS` from this task.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/widgets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WIDGET_IDS, isWidgetVisible, sanitizeHiddenWidgets } from './widgets';

describe('isWidgetVisible', () => {
  it('shows a widget that is not in the hidden list', () => {
    expect(isWidgetVisible(['weather'], 'clock')).toBe(true);
  });

  it('hides a widget that is in the hidden list', () => {
    expect(isWidgetVisible(['weather'], 'weather')).toBe(false);
  });

  it('shows everything when nothing is hidden', () => {
    expect(WIDGET_IDS.every((id) => isWidgetVisible([], id))).toBe(true);
  });
});

describe('sanitizeHiddenWidgets', () => {
  it('keeps known widget ids', () => {
    expect(sanitizeHiddenWidgets(['weather', 'note'])).toEqual(['weather', 'note']);
  });

  it('drops ids that no longer exist so a renamed widget cannot stay hidden forever', () => {
    expect(sanitizeHiddenWidgets(['weather', 'removed-widget'])).toEqual(['weather']);
  });

  it('returns an empty list for a non-array value', () => {
    expect(sanitizeHiddenWidgets('weather')).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(sanitizeHiddenWidgets(['note', 'note'])).toEqual(['note']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/widgets.test.ts`
Expected: FAIL with `Failed to resolve import "./widgets"`

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/widgets.ts`:

```ts
/**
 * Every toggleable widget. The id is stored in settings, so renaming one is a
 * migration — `sanitizeHiddenWidgets` makes a rename fail safe by dropping the
 * unknown id rather than hiding a widget the user can no longer find.
 */
export const WIDGET_IDS = [
  'clock',
  'quote',
  'weather',
  'calendar',
  'note',
  'countdown',
  'backgroundInfo',
  'pomodoro',
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

const KNOWN = new Set<string>(WIDGET_IDS);

export const isWidgetVisible = (hidden: readonly WidgetId[], id: WidgetId): boolean =>
  !hidden.includes(id);

export const sanitizeHiddenWidgets = (value: unknown): WidgetId[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is WidgetId => typeof v === 'string' && KNOWN.has(v)))];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/widgets.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Add the setting**

In `useSettings.ts` add `hiddenWidgets: WidgetId[];` to `HubSettings` and `hiddenWidgets: [],` to `DEFAULT_SETTINGS`. Import `type WidgetId` from `../widgets`.

In `merge()`, the generic loop assigns raw stored values. Add a targeted sanitising line immediately before `return next;`:

```ts
  next.hiddenWidgets = sanitizeHiddenWidgets(next.hiddenWidgets);
```

Do the same at the end of `applyChanges()`, before `state = { ... }`. Import `sanitizeHiddenWidgets`.

- [ ] **Step 6: Create the popup section**

Create `apps/extension/src/popup/WidgetsSection.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { WIDGET_IDS, type WidgetId } from '../widgets';
import { labelCls, sectionCls } from './Field';

export function WidgetsSection({
  hidden,
  onToggle,
}: {
  hidden: WidgetId[];
  onToggle: (id: WidgetId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${sectionCls} gap-3`}>
      <span className={labelCls}>{t('popup.widgets')}</span>
      <div className='flex flex-col gap-0.5 min-w-0'>
        {WIDGET_IDS.map((id) => (
          <label
            key={id}
            className='flex items-center gap-2.5 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-md transition-colors min-w-0'
          >
            <input
              type='checkbox'
              checked={!hidden.includes(id)}
              onChange={() => onToggle(id)}
              className='accent-white/70 w-3.5 h-3.5 rounded border-white/20 bg-zinc-900 cursor-pointer shrink-0'
            />
            <span className='text-sm text-white/90 truncate select-none min-w-0 flex-1'>
              {t(`widgets.${id}`)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire the tab**

In `TabNav.tsx`: add `'widgets'` to the `TabId` union and `{ id: 'widgets' as const, icon: LayoutGrid, labelKey: 'popup.tabWidgets' as const },` to `TABS` (import `LayoutGrid` from `lucide-react`).

In `PopupForm.tsx`: add `const [hiddenWidgets, setHiddenWidgets] = useState<WidgetId[]>(initialSettings.hiddenWidgets);`, a toggle handler

```tsx
  const toggleWidget = (id: WidgetId) =>
    setHiddenWidgets((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
```

`hiddenWidgets,` in the `onSave` object, and the render block:

```tsx
        {activeTab === 'widgets' && (
          <WidgetsSection hidden={hiddenWidgets} onToggle={toggleWidget} />
        )}
```

- [ ] **Step 8: Honour it in App**

In `App.tsx`, add `import { isWidgetVisible } from './widgets';` and a local helper after the `useSettings` call:

```tsx
  const show = (id: WidgetId) => isWidgetVisible(settings.hiddenWidgets, id);
```

Import `type WidgetId` from `./widgets`. Then gate each widget: wrap `<Clock />` in `{show('clock') && ...}`, `<QuoteWidget />` in `{show('quote') && ...}`, `<CalendarWidget />` in `{show('calendar') && ...}`, `<WeatherWidget />` in `{show('weather') && ...}`, `<QuickNote />` in `{show('note') && ...}`, `<CountdownWidget />` in `{show('countdown') && ...}`, and `<BackgroundInfo data={bgData} />` in `{show('backgroundInfo') && ...}`.

Leave `pomodoro` ungated — Task 9 adds that widget.

- [ ] **Step 9: Add the locale strings**

`en.json`: under `popup` add `"widgets": "Visible widgets"`, `"tabWidgets": "Widgets"`. Add a new top-level `"widgets"` object: `clock: "Clock"`, `quote: "Daily quote"`, `weather: "Weather"`, `calendar: "Calendar"`, `note: "Quick note"`, `countdown: "Countdown"`, `backgroundInfo: "Photo credit"`, `pomodoro: "Focus timer"`.

`hu.json`: under `popup` add `"widgets": "Látható widgetek"`, `"tabWidgets": "Widgetek"`. New top-level `"widgets"`: `clock: "Óra"`, `quote: "Napi idézet"`, `weather: "Időjárás"`, `calendar: "Naptár"`, `note: "Jegyzet"`, `countdown: "Visszaszámláló"`, `backgroundInfo: "Fotó kredit"`, `pomodoro: "Fókusz időzítő"`.

- [ ] **Step 10: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test`

```bash
git add apps/extension/src/widgets.ts apps/extension/src/widgets.test.ts apps/extension/src/popup/WidgetsSection.tsx apps/extension/src/hooks/useSettings.ts apps/extension/src/popup/TabNav.tsx apps/extension/src/popup/PopupForm.tsx apps/extension/src/App.tsx apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json
git commit -m "feat(extension): let each widget be hidden from the popup

Nothing could be turned off before, so the dashboard was take-it-or-leave-it."
```

---

### Task 3: Multi-day forecast

The Open-Meteo request already asks for a `daily` block but only reads `sunrise`/`sunset`. Three more fields give a 4-day strip with no new API and no new permission.

**Files:**
- Create: `apps/extension/src/utils/forecast.ts`
- Create: `apps/extension/src/utils/forecast.test.ts`
- Modify: `apps/extension/src/hooks/useWeather.ts` (request the extra fields, expose `daily`)
- Modify: `apps/extension/src/components/WeatherWidget.tsx` (render the strip)
- Modify: `apps/extension/src/i18n/locales/en.json`, `hu.json`

**Interfaces:**
- Consumes: `getWeatherIcon(code, isDaytime)` from `src/utils/weatherMapping.tsx`.
- Produces: `DailyForecast`, `summarizeDaily(daily, days?)` from `src/utils/forecast.ts`; `WeatherData.daily: DailyForecast[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/utils/forecast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeDaily, type DailyBlock } from './forecast';

const block: DailyBlock = {
  time: ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03'],
  temperature_2m_max: [28.4, 30.9, 26.1, 24.8, 22.2],
  temperature_2m_min: [17.6, 19.2, 15.4, 14.9, 13.1],
  weather_code: [0, 2, 61, 3, 95],
};

describe('summarizeDaily', () => {
  it('rounds the temperatures to whole degrees', () => {
    expect(summarizeDaily(block)[0]).toEqual({
      date: '2026-07-30',
      max: 28,
      min: 18,
      code: 0,
    });
  });

  it('returns four days by default', () => {
    expect(summarizeDaily(block)).toHaveLength(4);
  });

  it('honours an explicit day count', () => {
    expect(summarizeDaily(block, 2).map((d) => d.date)).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('never returns more days than the forecast contains', () => {
    const short: DailyBlock = {
      time: ['2026-07-30'],
      temperature_2m_max: [20],
      temperature_2m_min: [10],
      weather_code: [0],
    };
    expect(summarizeDaily(short, 4)).toHaveLength(1);
  });

  it('returns nothing for an empty forecast', () => {
    expect(summarizeDaily({ time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [] })).toEqual([]);
  });

  it('survives a block missing the temperature arrays entirely', () => {
    expect(summarizeDaily({ time: ['2026-07-30'] } as unknown as DailyBlock)).toEqual([]);
  });

  it('skips days with a missing temperature rather than reporting NaN', () => {
    const gappy: DailyBlock = {
      time: ['2026-07-30', '2026-07-31'],
      temperature_2m_max: [20, null as unknown as number],
      temperature_2m_min: [10, 5],
      weather_code: [0, 1],
    };
    expect(summarizeDaily(gappy).map((d) => d.date)).toEqual(['2026-07-30']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/utils/forecast.test.ts`
Expected: FAIL with `Failed to resolve import "./forecast"`

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/utils/forecast.ts`:

```ts
/** Slice of the Open-Meteo `daily` block the strip needs. */
export interface DailyBlock {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  weather_code: number[];
}

export interface DailyForecast {
  date: string;
  max: number;
  min: number;
  code: number;
}

const DEFAULT_DAYS = 4;

/**
 * Condenses the daily block into the strip under the current conditions.
 *
 * A day missing either temperature is dropped: Open-Meteo occasionally returns
 * a null at the edge of the range, and `Math.round(null)` would render as 0°.
 */
export const summarizeDaily = (daily: DailyBlock, days = DEFAULT_DAYS): DailyForecast[] => {
  const out: DailyForecast[] = [];

  for (let i = 0; i < daily.time.length && out.length < days; i++) {
    const max = daily.temperature_2m_max?.[i];
    const min = daily.temperature_2m_min?.[i];
    if (typeof max !== 'number' || typeof min !== 'number') continue;

    out.push({
      date: daily.time[i],
      max: Math.round(max),
      min: Math.round(min),
      code: daily.weather_code?.[i] ?? 0,
    });
  }

  return out;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/utils/forecast.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Request the extra fields and expose them**

In `useWeather.ts`:

Add `daily: DailyForecast[];` to the `WeatherData` interface and import `summarizeDaily, type DailyForecast` from `../utils/forecast`.

Change the forecast URL's `daily=` parameter from `daily=sunrise,sunset` to `daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code`.

Add `daily: summarizeDaily(wData.daily),` to the `weather` object literal, next to `rain:`.

**Guard the cache read.** `useWeather` seeds its state from a `localStorage`
entry written by the previous version, which has no `daily` key — the widget
would then call `.length` on `undefined` on the first load after an update. In
the lazy `useState` initialiser, replace `return parsed.weather || null;` with:

```ts
        if (parsed.weather) {
          // A cache entry written before this field existed has no `daily`.
          return { ...parsed.weather, daily: parsed.weather.daily ?? [] };
        }
```

Do the same where the cache-hit path calls `setData(cachedData.weather)`:

```ts
            setData({ ...cachedData.weather, daily: cachedData.weather.daily ?? [] });
```

- [ ] **Step 6: Render the strip**

In `WeatherWidget.tsx`, add imports:

```tsx
import { enUS, hu } from 'date-fns/locale';
import { parseISO } from 'date-fns';
```

and inside the component, after the existing `getRainTimeLabel` definition:

```tsx
  const dateLocale = i18n.language.startsWith('hu') ? hu : enUS;
```

Change `const { t } = useTranslation();` to `const { t, i18n } = useTranslation();`.

Then, immediately before the closing `</div>` of the details section (after the precipitation row), add:

```tsx
        {data.daily.length > 0 && (
          <div className='grid grid-cols-4 gap-1.5 pt-1.5 border-t border-white/5'>
            {data.daily.map((day) => (
              <div
                key={day.date}
                className='flex flex-col items-center gap-1 p-1.5 rounded-lg bg-white/5 hover:bg-white/[0.07] transition-colors'
                title={format(parseISO(day.date), 'PPP', { locale: dateLocale })}
              >
                <span className='text-[9px] uppercase font-bold text-white/40 tracking-wider'>
                  {format(parseISO(day.date), 'EEEEEE', { locale: dateLocale })}
                </span>
                <div className='scale-[0.7]'>{getWeatherIcon(day.code, true)}</div>
                <span className='text-[10px] font-medium text-white/90'>
                  {day.max}° <span className='text-white/40'>{day.min}°</span>
                </span>
              </div>
            ))}
          </div>
        )}
```

Also add `daily: []` to the loading-skeleton path if the compiler requires it — it does not, the skeleton returns early.

- [ ] **Step 7: Add the locale string**

`en.json` under `weather`: `"forecast": "Next days"`. `hu.json` under `weather`: `"forecast": "Következő napok"`.

Use it as an `aria-label` on the grid container: `aria-label={t('weather.forecast')}`.

- [ ] **Step 8: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test`

```bash
git add apps/extension/src/utils/forecast.ts apps/extension/src/utils/forecast.test.ts apps/extension/src/hooks/useWeather.ts apps/extension/src/components/WeatherWidget.tsx apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json
git commit -m "feat(extension): show a four-day forecast

The Open-Meteo request already asked for a daily block; only sunrise and
sunset were being read from it."
```

---

### Task 4: Custom background image

Adds an explicit background source selector. A user-supplied image goes into the same Cache API bucket as Unsplash photos, under a synthetic key.

**Files:**
- Modify: `apps/extension/src/utils/imageCache.ts` (add `CUSTOM_IMAGE_KEY`, `putCustomImage`, `hasCustomImage`)
- Modify: `apps/extension/src/utils/imageCache.test.ts`
- Modify: `apps/extension/src/hooks/useSettings.ts` (add `backgroundSource`)
- Modify: `apps/extension/src/hooks/useBackground.ts`
- Modify: `apps/extension/src/hooks/useBackground.test.ts`
- Modify: `apps/extension/src/popup/PopupForm.tsx`
- Modify: `apps/extension/src/i18n/locales/en.json`, `hu.json`

**Interfaces:**
- Consumes: `cacheImage`, `getCachedImageSrc`, `pruneImageCache` from `src/utils/imageCache.ts`; `HubSettings` from Tasks 1–2.
- Produces: `CUSTOM_IMAGE_KEY`, `putCustomImage(blob)`, `hasCustomImage()`; `HubSettings.backgroundSource`.

- [ ] **Step 1: Write the failing test**

Append to `apps/extension/src/utils/imageCache.test.ts`, inside the existing `describe('imageCache', ...)`:

```ts
  it('stores a user-supplied image without going to the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('must not fetch a local file');
      }),
    );

    const stored = await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));

    expect(stored).toBe(true);
    expect(await getCachedImageSrc(CUSTOM_IMAGE_KEY)).toBeTypeOf('string');
  });

  it('reports whether a custom image is present', async () => {
    expect(await hasCustomImage()).toBe(false);

    await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));

    expect(await hasCustomImage()).toBe(true);
  });

  it('keeps the custom image when unreferenced Unsplash photos are pruned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['bytes'], { type: 'image/jpeg' }))),
    );
    await cacheImage(REMOTE);
    await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));

    await pruneImageCache([]);

    expect(await getCachedImageSrc(CUSTOM_IMAGE_KEY)).toBeTypeOf('string');
    expect(await getCachedImageSrc(REMOTE)).toBeNull();
  });
```

Extend the import at the top of the file to include `CUSTOM_IMAGE_KEY`, `hasCustomImage`, `putCustomImage`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/utils/imageCache.test.ts`
Expected: FAIL with `putCustomImage is not a function`

- [ ] **Step 3: Write minimal implementation**

In `apps/extension/src/utils/imageCache.ts`, add after `IMAGE_CACHE_NAME`:

```ts
/**
 * Cache key for a user-supplied background.
 *
 * A `hub://` URL is never fetched — it exists only so the custom image can live
 * in the same cache as Unsplash photos and be read back by the same code path.
 */
export const CUSTOM_IMAGE_KEY = 'hub://custom-background';
```

Add these exports:

```ts
/** Stores a user-picked file. Unlike `cacheImage` there is nothing to download. */
export const putCustomImage = async (file: Blob): Promise<boolean> => {
  const cache = await openCache();
  if (!cache) return false;

  try {
    await cache.put(CUSTOM_IMAGE_KEY, new Response(file));
    return true;
  } catch (error) {
    console.error('Failed to store the custom background:', error);
    return false;
  }
};

export const hasCustomImage = async (): Promise<boolean> => {
  const cache = await openCache();
  if (!cache) return false;
  return (await cache.match(CUSTOM_IMAGE_KEY)) !== undefined;
};
```

Change `pruneImageCache` so it never evicts the custom image:

```ts
export const pruneImageCache = async (keepUrls: string[]): Promise<void> => {
  const cache = await openCache();
  if (!cache) return;

  // The custom image is not part of the rotating pool and is never re-downloadable.
  const keep = new Set([...keepUrls, CUSTOM_IMAGE_KEY]);
  const requests = await cache.keys();
  await Promise.all(
    requests.filter((request) => !keep.has(request.url)).map((request) => cache.delete(request)),
  );
};
```

Note: `new Request('hub://custom-background').url` keeps the string as-is, so `keep.has(request.url)` matches.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/utils/imageCache.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Write the failing hook test**

Append to `apps/extension/src/hooks/useBackground.test.ts` inside `describe('useBackground', ...)`:

```ts
  it('serves the custom image and makes no request when that source is selected', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ backgroundSource: 'custom' });
    const fetchMock = stubFetch();
    const { putCustomImage } = await import('../utils/imageCache');
    await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.imageSrc).toBeTruthy());
    expect(backgroundRequests(fetchMock)).toHaveLength(0);
    expect(result.current.imageSrc).not.toContain('unsplash.com');
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/hooks/useBackground.test.ts`
Expected: FAIL — a background request is made because the hook ignores `backgroundSource`.

- [ ] **Step 7: Add the setting and teach the hook about it**

In `useSettings.ts`: add `backgroundSource: 'unsplash' | 'custom';` to `HubSettings` and `backgroundSource: 'unsplash',` to `DEFAULT_SETTINGS`.

In `useBackground.ts`:

Import `CUSTOM_IMAGE_KEY` alongside the existing imageCache imports.

Guard the revalidation effect:

```ts
  useEffect(() => {
    if (!isLoaded) return;
    if (settings.backgroundSource === 'custom') return;

    // No force flag needed: the cache packet stores the query it was built for,
    // so a changed query is already a cache miss inside fetchNewImage.
    fetchNewImage(false, settings.unsplashQuery);
  }, [fetchNewImage, isLoaded, settings.backgroundSource, settings.unsplashQuery]);
```

Change the resolve effect to look up the custom key when that source is active. Replace `if (!bgData.url) return;` and the `getCachedImageSrc(bgData.url)` call with a computed key:

```ts
  const custom = settings.backgroundSource === 'custom';
  const cacheKey = custom ? CUSTOM_IMAGE_KEY : bgData.url;

  useEffect(() => {
    if (!cacheKey) return;

    let revoked = false;
    let objectUrl: string | null = null;

    getCachedImageSrc(cacheKey).then((src) => {
      if (!src) return;
      if (revoked) {
        URL.revokeObjectURL(src);
        return;
      }
      objectUrl = src;
      setCachedSrc(src);
    });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheKey]);
```

Change the return so a custom background reports no photographer credit:

```ts
  return {
    bgData: custom ? EMPTY_BG_DATA : bgData,
    // Prefer the local copy: it renders instantly and survives being offline.
    imageSrc: cachedSrc ?? (custom ? '' : bgData.url) ?? '',
    refreshBackground: () => fetchNewImage(true, settings.unsplashQuery),
    loading,
    isSettingsLoaded: isLoaded,
  };
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/extension && pnpm vitest run src/hooks/useBackground.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Add the popup control**

In `PopupForm.tsx`, add state:

```tsx
  const [backgroundSource, setBackgroundSource] = useState(initialSettings.backgroundSource);
  const [uploadError, setUploadError] = useState<string | null>(null);
```

Add `backgroundSource,` to the `onSave` object.

Add the upload handler:

```tsx
  const handleUpload = async (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError(t('popup.uploadNotImage'));
      return;
    }
    const { putCustomImage } = await import('../utils/imageCache');
    if (await putCustomImage(file)) {
      setBackgroundSource('custom');
    } else {
      setUploadError(t('popup.uploadFailed'));
    }
  };
```

Inside the `appearance` tab block, above the query `Field`, add the source selector and upload control:

```tsx
          <Field label={t('popup.backgroundSource')}>
            <div className='flex flex-col gap-1'>
              {(['unsplash', 'custom'] as const).map((source) => (
                <label key={source} className='flex items-center gap-2.5 cursor-pointer text-sm'>
                  <input
                    type='radio'
                    name='backgroundSource'
                    value={source}
                    checked={backgroundSource === source}
                    onChange={() => setBackgroundSource(source)}
                    className='accent-white/70 shrink-0'
                  />
                  <span className='select-none'>{t(`popup.source_${source}`)}</span>
                </label>
              ))}
            </div>
          </Field>

          {backgroundSource === 'custom' && (
            <Field id='upload' label={t('popup.upload')} hint={uploadError ?? t('popup.uploadHint')}>
              <input
                id='upload'
                type='file'
                accept='image/*'
                onChange={(e) => void handleUpload(e.target.files?.[0])}
                className='w-full text-xs'
              />
            </Field>
          )}
```

Only render the Unsplash tag `Field` when `backgroundSource === 'unsplash'`.

- [ ] **Step 10: Add the locale strings**

`en.json` under `popup`: `"backgroundSource": "Background source"`, `"source_unsplash": "Unsplash photos"`, `"source_custom": "My own image"`, `"upload": "Choose an image"`, `"uploadHint": "Stored on this device only."`, `"uploadNotImage": "That file is not an image."`, `"uploadFailed": "Could not store the image."`

`hu.json` under `popup`: `"backgroundSource": "Háttér forrása"`, `"source_unsplash": "Unsplash fotók"`, `"source_custom": "Saját kép"`, `"upload": "Kép kiválasztása"`, `"uploadHint": "Csak ezen az eszközön tárolódik."`, `"uploadNotImage": "Ez a fájl nem kép."`, `"uploadFailed": "A kép mentése nem sikerült."`

- [ ] **Step 11: Update the privacy policy**

In `apps/extension/privacy-policy.md`, in the "Local Storage (`storage` permission)" list, extend the Cache storage bullet to mention that a user-supplied background image, if chosen, is stored there and never uploaded anywhere.

- [ ] **Step 12: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test`

```bash
git add apps/extension/src/utils/imageCache.ts apps/extension/src/utils/imageCache.test.ts apps/extension/src/hooks/useSettings.ts apps/extension/src/hooks/useBackground.ts apps/extension/src/hooks/useBackground.test.ts apps/extension/src/popup/PopupForm.tsx apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json apps/extension/privacy-policy.md
git commit -m "feat(extension): allow a custom background image

Images already live in the Cache API, so a user-supplied file fits the
same store under a synthetic key and is never uploaded anywhere."
```

---

### Task 5: Service worker background prefetch

The new tab currently waits on the network the first time each day. The service worker prefetches tomorrow's image so the page never does.

**The `localStorage` constraint drives the design:** the service worker cannot touch `localStorage`, so the prefetched metadata goes into `chrome.storage.local` and the page adopts it on load.

**Files:**
- Create: `apps/extension/src/utils/api.ts`
- Create: `apps/extension/src/utils/prefetch.ts`
- Create: `apps/extension/src/utils/prefetch.test.ts`
- Modify: `apps/extension/src/background.ts`
- Modify: `apps/extension/src/hooks/useBackground.ts`
- Modify: `apps/extension/src/hooks/useBackground.test.ts`
- Modify: `apps/extension/src/test/chromeStub.ts` (make `storage.local` real, add `alarms`)
- Modify: `apps/extension/manifest.json` (add `alarms`)
- Modify: `apps/extension/privacy-policy.md`

**Interfaces:**
- Consumes: `cacheImage` from `src/utils/imageCache.ts`; `getDailyData`/`setDailyData` from `src/utils/dailyStorage.ts`; `HubSettings.unsplashQuery`.
- Produces: `BACKGROUND_ENDPOINT`, `QUOTE_ENDPOINT`, `backgroundRequestUrl(query)` from `src/utils/api.ts` (Task 7 consumes `QUOTE_ENDPOINT`); `PrefetchPacket`, `readPrefetch`, `savePrefetch`, `clearPrefetch`, `prefetchBackground(query, date)` from `src/utils/prefetch.ts`.

- [ ] **Step 1: Make the chrome stub support local storage and alarms**

In `apps/extension/src/test/chromeStub.ts`, replace the placeholder `local` object with a real in-memory store backed by its own `Map`, and add an `alarms` namespace. Add to the returned `ChromeStub` interface: `seedLocal`, `readLocal`, `createdAlarms`.

```ts
  const localStore = new Map<string, unknown>();
  const alarms: { name: string; info: unknown }[] = [];
```

`local` becomes:

```ts
      local: {
        get: (keys: string[] | string, cb: (items: Record<string, unknown>) => void) => {
          const wanted = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of wanted) {
            if (localStore.has(key)) result[key] = localStore.get(key);
          }
          queueMicrotask(() => cb(result));
        },
        set: (items: Record<string, unknown>, cb?: () => void) => {
          for (const [key, value] of Object.entries(items)) localStore.set(key, value);
          queueMicrotask(() => cb?.());
        },
        remove: (key: string, cb?: () => void) => {
          localStore.delete(key);
          queueMicrotask(() => cb?.());
        },
      },
```

and add a sibling namespace on `chromeStub`:

```ts
    alarms: {
      create: (name: string, info: unknown) => alarms.push({ name, info }),
      onAlarm: { addListener: () => {} },
    },
    runtime: {
      lastError: undefined as { message: string } | undefined,
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
```

Return `seedLocal: (v) => { for (const [k, val] of Object.entries(v)) localStore.set(k, val); }`, `readLocal: (k) => localStore.get(k)`, `createdAlarms: () => [...alarms]`.

- [ ] **Step 2: Write the failing test**

Create `apps/extension/src/utils/prefetch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const load = async () => await import('./prefetch');

const metadata = {
  url: 'https://images.unsplash.com/tomorrow',
  location: null,
  photographer: 'Tomorrow',
  photographerUrl: '',
};

const stubFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/background')
      ? new Response(JSON.stringify(metadata), { headers: { 'Content-Type': 'application/json' } })
      : new Response(new Blob(['bytes'], { type: 'image/jpeg' })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('prefetchBackground', () => {
  it('stores the metadata under the requested date', async () => {
    installChromeStub();
    stubFetch();
    const { prefetchBackground, readPrefetch } = await load();

    expect(await prefetchBackground('forest', '2026-08-01')).toBe(true);

    expect(await readPrefetch()).toEqual({
      date: '2026-08-01',
      query: 'forest',
      data: metadata,
    });
  });

  it('downloads the image so the page never waits on the network', async () => {
    installChromeStub();
    const fetchMock = stubFetch();
    const { prefetchBackground } = await load();

    await prefetchBackground('forest', '2026-08-01');

    expect(fetchMock.mock.calls.some(([i]) => String(i) === metadata.url)).toBe(true);
  });

  it('reports failure and stores nothing when the worker is unreachable', async () => {
    installChromeStub();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { prefetchBackground, readPrefetch } = await load();

    expect(await prefetchBackground('forest', '2026-08-01')).toBe(false);
    expect(await readPrefetch()).toBeNull();
  });

  it('returns null when nothing has been prefetched', async () => {
    installChromeStub();
    const { readPrefetch } = await load();

    expect(await readPrefetch()).toBeNull();
  });

  it('clears a stored packet', async () => {
    installChromeStub();
    stubFetch();
    const { prefetchBackground, clearPrefetch, readPrefetch } = await load();
    await prefetchBackground('forest', '2026-08-01');

    await clearPrefetch();

    expect(await readPrefetch()).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/utils/prefetch.test.ts`
Expected: FAIL with `Failed to resolve import "./prefetch"`

- [ ] **Step 4: Write the API constants**

Create `apps/extension/src/utils/api.ts`:

```ts
const BASE = 'https://hub-api.csiszaralex.workers.dev';

export const BACKGROUND_ENDPOINT = `${BASE}/api/background`;
export const QUOTE_ENDPOINT = `${BASE}/api/quote`;

export const backgroundRequestUrl = (query: string): string => {
  const url = new URL(BACKGROUND_ENDPOINT);
  if (query) url.searchParams.set('tags', query);
  return url.toString();
};
```

- [ ] **Step 5: Write the prefetch module**

Create `apps/extension/src/utils/prefetch.ts`:

```ts
import type { BackgroundData } from '@hub/shared';
import { backgroundRequestUrl } from './api';
import { cacheImage } from './imageCache';

/**
 * Hand-off slot between the service worker and the new tab page.
 *
 * `chrome.storage.local` rather than `localStorage`, because a service worker
 * has no access to the latter. The page adopts the packet on load and moves it
 * into its own daily cache.
 */
const PREFETCH_KEY = 'prefetched_bg';

export interface PrefetchPacket {
  date: string;
  query: string;
  data: BackgroundData;
}

export const readPrefetch = (): Promise<PrefetchPacket | null> =>
  new Promise((resolve) => {
    chrome.storage.local.get([PREFETCH_KEY], (items) => {
      const packet = items[PREFETCH_KEY] as PrefetchPacket | undefined;
      resolve(packet?.date && packet?.data ? packet : null);
    });
  });

export const savePrefetch = (packet: PrefetchPacket): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.set({ [PREFETCH_KEY]: packet }, () => resolve());
  });

export const clearPrefetch = (): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.remove(PREFETCH_KEY, () => resolve());
  });

/** Fetches metadata and the image itself for `date`, ready for the page to adopt. */
export const prefetchBackground = async (query: string, date: string): Promise<boolean> => {
  try {
    const res = await fetch(backgroundRequestUrl(query));
    if (!res.ok) return false;

    const data: BackgroundData = await res.json();
    if (!(await cacheImage(data.url))) return false;

    await savePrefetch({ date, query, data });
    return true;
  } catch (error) {
    console.error('Background prefetch failed:', error);
    return false;
  }
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/utils/prefetch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Write the failing adoption test**

Append to `apps/extension/src/hooks/useBackground.test.ts` inside `describe('useBackground', ...)`:

```ts
  it('adopts a prefetched image instead of making a request', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Prefetched'));
    expect(backgroundRequests(fetchMock)).toHaveLength(0);
  });

  it('ignores a prefetched image built for a different query', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    expect(backgroundRequests(fetchMock)).toHaveLength(1);
  });
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/hooks/useBackground.test.ts`
Expected: FAIL — the first new test makes a background request because the hook does not read the prefetch slot.

- [ ] **Step 9: Teach the hook to adopt a prefetch**

In `useBackground.ts`, import `clearPrefetch, readPrefetch` from `../utils/prefetch` and `backgroundRequestUrl` from `../utils/api`. Replace the inline `WORKER_URL`/`new URL(...)` construction in `fetchNewImage` with `await fetch(backgroundRequestUrl(currentQuery))` and delete the `WORKER_URL` constant.

Insert an adoption attempt at the top of `fetchNewImage`, immediately after the existing cache check:

```ts
      if (!force && getDailyData(CACHE_KEY, currentQuery)) return;

      // The service worker may already have today's image cached.
      if (!force) {
        const packet = await readPrefetch();
        if (packet && packet.date === todayIso() && packet.query === currentQuery) {
          setBgData(packet.data);
          setDailyData(CACHE_KEY, packet.data, currentQuery);
          await clearPrefetch();
          return;
        }
      }
```

Add the helper next to `EMPTY_BG_DATA`:

```ts
const todayIso = () => new Date().toISOString().split('T')[0];
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/hooks/useBackground.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 11: Schedule the prefetch in the service worker**

Replace `apps/extension/src/background.ts` with:

```ts
import { deleteObsoleteImageCaches } from './utils/imageCache';
import { prefetchBackground } from './utils/prefetch';

/**
 * The dashboard needs no background processing, so the service worker has only
 * housekeeping jobs.
 *
 * 1. Drop image caches written by an older format — an extension update is the
 *    only moment where a previous version's bucket can be identified.
 * 2. Prefetch tomorrow's background so the new tab page never waits on the
 *    network. Chrome fires a missed alarm at the next startup, and the page
 *    falls back to fetching on demand, so a machine asleep at 03:00 degrades
 *    to today's behaviour rather than breaking.
 */
const PREFETCH_ALARM = 'prefetch-background';

const scheduleAlarm = () => {
  chrome.alarms.create(PREFETCH_ALARM, { periodInMinutes: 24 * 60 });
};

const tomorrowIso = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

const runPrefetch = () => {
  chrome.storage.sync.get(['unsplashQuery', 'backgroundSource'], (settings) => {
    // A custom background needs no prefetching.
    if (settings.backgroundSource === 'custom') return;
    void prefetchBackground((settings.unsplashQuery as string) ?? '', tomorrowIso());
  });
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') {
    void deleteObsoleteImageCaches();
  }
  scheduleAlarm();
});

chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PREFETCH_ALARM) runPrefetch();
});
```

- [ ] **Step 12: Add the permission and update the policy**

In `apps/extension/manifest.json`, change `"permissions": ["storage", "geolocation", "identity"]` to `"permissions": ["storage", "geolocation", "identity", "alarms"]`.

In `apps/extension/privacy-policy.md`, add a numbered subsection under "Data We Access and How We Use It":

> ### 4. Scheduled Background Prefetch (`alarms` permission)
>
> Hub schedules a daily task that downloads the next day's background image in advance, so opening a new tab never waits on the network.
>
> - **Usage:** The task sends only your configured background search tags to the Hub API, exactly as the dashboard itself does. It reads no browsing data and runs no other work.
> - **Storage:** The downloaded image goes into the browser's Cache storage and its metadata into `chrome.storage.local`, both on your device only.

- [ ] **Step 13: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test build`

```bash
git add apps/extension/src/utils/api.ts apps/extension/src/utils/prefetch.ts apps/extension/src/utils/prefetch.test.ts apps/extension/src/background.ts apps/extension/src/hooks/useBackground.ts apps/extension/src/hooks/useBackground.test.ts apps/extension/src/test/chromeStub.ts apps/extension/manifest.json apps/extension/privacy-policy.md
git commit -m "feat(extension): prefetch tomorrow's background in the service worker

The first new tab each day waited on the worker and a 4K download. A daily
alarm now caches the next image ahead of time; the page falls back to
fetching on demand when the prefetch did not run."
```

---

### Task 6: Quote proxy endpoint on the Hub API

`stoic.tekloon.net` is a single-person service with no SLA and is currently a single point of failure. This puts it behind the worker with a KV day-cache, so the upstream is hit once per day for all users instead of once per user.

**Files:**
- Modify: `packages/shared/src/index.ts` (add `QuoteData`)
- Create: `apps/api/src/quote.ts`
- Create: `apps/api/src/quote.test.ts`
- Modify: `apps/api/src/index.ts` (mount the route)
- Modify: `apps/api/README.md`

**Interfaces:**
- Consumes: the `Bindings` type and KV binding pattern from `apps/api/src/index.ts`.
- Produces: `QuoteData` from `@hub/shared`; `GET /api/quote` returning `QuoteData`; `quoteCacheKey(isoDate)` from `apps/api/src/quote.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/quote.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from './index';
import { quoteCacheKey } from './quote';
import { createKvStub } from './test/kvStub';

const upstream = (text: string, author: string) =>
  new Response(JSON.stringify({ data: { quote: text, author } }), {
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

const env = (kv: KVNamespace) => ({ UNSPLASH_CACHE: kv, UNSPLASH_ACCESS_KEY: 'test-key' });

beforeEach(() => {
  fetchMock = vi.fn(async () => upstream('Waste no more time arguing.', 'Marcus Aurelius'));
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /api/quote', () => {
  it('returns the upstream quote', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/quote', {}, env(kv));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      text: 'Waste no more time arguing.',
      author: 'Marcus Aurelius',
    });
  });

  it('hits the upstream once per day no matter how many callers ask', async () => {
    const { kv } = createKvStub();

    await app.request('/api/quote', {}, env(kv));
    await app.request('/api/quote', {}, env(kv));
    await app.request('/api/quote', {}, env(kv));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keys the day cache by date', () => {
    expect(quoteCacheKey('2026-07-30')).toBe('quote:2026-07-30');
  });

  it('serves the last good quote when the upstream is down', async () => {
    const { kv, seed } = createKvStub();
    seed('quote:latest', { text: 'Old but present.', author: 'Seneca' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const res = await app.request('/api/quote', {}, env(kv));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: 'Old but present.', author: 'Seneca' });
  });

  it('reports unavailable when the upstream is down and nothing is cached', async () => {
    const { kv } = createKvStub();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect((await app.request('/api/quote', {}, env(kv))).status).toBe(503);
  });

  it('rejects an upstream response that is missing the quote text', async () => {
    const { kv } = createKvStub();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: {} }), { headers: { 'Content-Type': 'application/json' } })),
    );

    expect((await app.request('/api/quote', {}, env(kv))).status).toBe(503);
  });
});
```

`apps/api/src/test/kvStub.ts` already exposes `seed` and `keys`; no change is needed there.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/quote.test.ts`
Expected: FAIL with `Failed to resolve import "./quote"`

- [ ] **Step 3: Add the shared type**

In `packages/shared/src/index.ts` append:

```ts
/** Response shape of `GET /api/quote`. */
export interface QuoteData {
  text: string;
  author: string;
}
```

- [ ] **Step 4: Write the route**

Create `apps/api/src/quote.ts`:

```ts
import { QuoteData } from '@hub/shared';
import { Hono } from 'hono';

type Bindings = {
  UNSPLASH_CACHE: KVNamespace;
};

const UPSTREAM = 'https://stoic.tekloon.net/stoic-quote';

/** Pointer to the newest successfully cached quote, for use when upstream is down. */
const LATEST_KEY = 'quote:latest';
const QUOTE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const quoteCacheKey = (isoDate: string) => `quote:${isoDate}`;

const todayIso = () => new Date().toISOString().split('T')[0];

export const quoteRoutes = new Hono<{ Bindings: Bindings }>();

quoteRoutes.get('/api/quote', async (c) => {
  const key = quoteCacheKey(todayIso());

  const cached = await c.env.UNSPLASH_CACHE.get<QuoteData>(key, 'json');
  if (cached?.text) return c.json(cached);

  try {
    const res = await fetch(UPSTREAM);
    if (!res.ok) throw new Error(`Upstream error: ${res.status}`);

    const raw = (await res.json()) as { data?: { quote?: string; author?: string } };
    const quote: QuoteData = {
      text: raw.data?.quote ?? '',
      author: raw.data?.author ?? 'Unknown',
    };
    if (!quote.text) throw new Error('Upstream response had no quote');

    const body = JSON.stringify(quote);
    await c.env.UNSPLASH_CACHE.put(key, body, { expirationTtl: QUOTE_TTL_SECONDS });
    await c.env.UNSPLASH_CACHE.put(LATEST_KEY, body, { expirationTtl: QUOTE_TTL_SECONDS });
    return c.json(quote);
  } catch (error) {
    console.error(error);

    // Upstream is a one-person service; a stale quote beats an empty widget.
    const latest = await c.env.UNSPLASH_CACHE.get<QuoteData>(LATEST_KEY, 'json');
    if (latest?.text) return c.json(latest);

    return c.json({ error: 'No quote available' }, 503);
  }
});
```

- [ ] **Step 5: Mount the route**

In `apps/api/src/index.ts`, add `import { quoteRoutes } from './quote';` and, immediately after `app.use('/api/*', cors());`, add:

```ts
app.route('/', quoteRoutes);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && pnpm vitest run`
Expected: PASS (8 background tests + 6 quote tests)

- [ ] **Step 7: Document the endpoint**

In `apps/api/README.md`, after the background section, add a `## GET /api/quote` section describing: the daily KV cache, that the upstream is hit once per day for all users, the `quote:latest` fallback when upstream is down, and the `503` when nothing is cached.

- [ ] **Step 8: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test`

```bash
git add packages/shared/src/index.ts apps/api/src/quote.ts apps/api/src/quote.test.ts apps/api/src/index.ts apps/api/README.md
git commit -m "feat(api): proxy the daily quote with a KV day-cache

The upstream is a one-person service with no SLA and was hit once per user
per day. It is now hit once per day in total, with the last good quote
served if it goes away."
```

> **Deploy note for the reviewer:** this endpoint only becomes live after an `api@*` tag is pushed. Task 7 keeps working against the old direct upstream until then, because it falls back on any failure.

---

### Task 7: Quote resilience in the extension

Point `useQuote` at the worker and add a bundled fallback set so the widget never shows nothing.

**Files:**
- Create: `apps/extension/src/utils/quoteFallback.ts`
- Create: `apps/extension/src/utils/quoteFallback.test.ts`
- Create: `apps/extension/src/hooks/useQuote.test.ts`
- Modify: `apps/extension/src/hooks/useQuote.ts`
- Modify: `apps/extension/manifest.json` (drop the now-unused upstream host)
- Modify: `apps/extension/privacy-policy.md`, `apps/extension/README.md`

**Interfaces:**
- Consumes: `QUOTE_ENDPOINT` from `src/utils/api.ts` (Task 5); `getDailyData`/`setDailyData` from `src/utils/dailyStorage.ts`.
- Produces: `FALLBACK_QUOTES`, `pickFallbackQuote(isoDate)` from `src/utils/quoteFallback.ts`.

- [ ] **Step 1: Write the failing fallback test**

Create `apps/extension/src/utils/quoteFallback.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FALLBACK_QUOTES, pickFallbackQuote } from './quoteFallback';

describe('FALLBACK_QUOTES', () => {
  it('has enough entries that a repeat is not obvious', () => {
    expect(FALLBACK_QUOTES.length).toBeGreaterThanOrEqual(20);
  });

  it('has a text and an author for every entry', () => {
    for (const quote of FALLBACK_QUOTES) {
      expect(quote.text.length).toBeGreaterThan(0);
      expect(quote.author.length).toBeGreaterThan(0);
    }
  });
});

describe('pickFallbackQuote', () => {
  it('returns the same quote for the same day', () => {
    expect(pickFallbackQuote('2026-07-30')).toEqual(pickFallbackQuote('2026-07-30'));
  });

  it('returns a different quote on a different day', () => {
    expect(pickFallbackQuote('2026-07-30')).not.toEqual(pickFallbackQuote('2026-07-31'));
  });

  it('always returns one of the bundled quotes', () => {
    expect(FALLBACK_QUOTES).toContainEqual(pickFallbackQuote('2026-12-25'));
  });

  it('handles a malformed date without throwing', () => {
    expect(FALLBACK_QUOTES).toContainEqual(pickFallbackQuote('not-a-date'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/utils/quoteFallback.test.ts`
Expected: FAIL with `Failed to resolve import "./quoteFallback"`

- [ ] **Step 3: Write the fallback module**

Create `apps/extension/src/utils/quoteFallback.ts`. Include exactly 24 public-domain Stoic quotes (Marcus Aurelius *Meditations*, Seneca *Letters*, Epictetus *Enchiridion* — all long out of copyright). Rotate by day so the same date always yields the same quote:

```ts
/**
 * Bundled quotes for when the network or the quote service is unavailable.
 *
 * Public-domain translations only. Rotated by date so a given day is stable —
 * the quote must not change every time a new tab opens.
 */
export const FALLBACK_QUOTES = [
  { text: 'You have power over your mind — not outside events. Realize this, and you will find strength.', author: 'Marcus Aurelius' },
  { text: 'Waste no more time arguing about what a good man should be. Be one.', author: 'Marcus Aurelius' },
  { text: 'The happiness of your life depends upon the quality of your thoughts.', author: 'Marcus Aurelius' },
  { text: 'If it is not right, do not do it; if it is not true, do not say it.', author: 'Marcus Aurelius' },
  { text: 'Confine yourself to the present.', author: 'Marcus Aurelius' },
  { text: 'The best revenge is not to be like your enemy.', author: 'Marcus Aurelius' },
  { text: 'Very little is needed to make a happy life; it is all within yourself, in your way of thinking.', author: 'Marcus Aurelius' },
  { text: 'Loss is nothing else but change, and change is Nature’s delight.', author: 'Marcus Aurelius' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'Luck is what happens when preparation meets opportunity.', author: 'Seneca' },
  { text: 'Difficulties strengthen the mind, as labour does the body.', author: 'Seneca' },
  { text: 'He who is brave is free.', author: 'Seneca' },
  { text: 'As long as you live, keep learning how to live.', author: 'Seneca' },
  { text: 'Begin at once to live, and count each separate day as a separate life.', author: 'Seneca' },
  { text: 'No person has the power to have everything they want, but it is in their power not to want what they don’t have.', author: 'Seneca' },
  { text: 'It is not what happens to you, but how you react to it that matters.', author: 'Epictetus' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus' },
  { text: 'He who laughs at himself never runs out of things to laugh at.', author: 'Epictetus' },
  { text: 'Only the educated are free.', author: 'Epictetus' },
  { text: 'Wealth consists not in having great possessions, but in having few wants.', author: 'Epictetus' },
  { text: 'If you want to improve, be content to be thought foolish and stupid.', author: 'Epictetus' },
  { text: 'Circumstances don’t make the man, they only reveal him to himself.', author: 'Epictetus' },
  { text: 'It’s not what you know, but what you practise.', author: 'Epictetus' },
] as const;

/** Stable per-day choice. A malformed date falls back to index 0. */
export const pickFallbackQuote = (isoDate: string): { text: string; author: string } => {
  const days = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
  const index = Number.isFinite(days) ? Math.abs(days) % FALLBACK_QUOTES.length : 0;
  return FALLBACK_QUOTES[index];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/utils/quoteFallback.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing hook test**

Create `apps/extension/src/hooks/useQuote.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_QUOTES } from '../utils/quoteFallback';

const loadUseQuote = async () => (await import('./useQuote')).useQuote;

describe('useQuote', () => {
  it('shows the quote the worker returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ text: 'From the worker.', author: 'Seneca' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(result.current.text).toBe('From the worker.'));
  });

  it('falls back to a bundled quote when the worker is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(FALLBACK_QUOTES).toContainEqual(result.current));
  });

  it('falls back when the worker replies with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(FALLBACK_QUOTES).toContainEqual(result.current));
  });

  it('makes no request when today\'s quote is already cached', async () => {
    localStorage.setItem(
      'daily_quote',
      JSON.stringify({
        date: new Date().toISOString().split('T')[0],
        data: { text: 'Cached.', author: 'Epictetus' },
      }),
    );
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    expect(result.current.text).toBe('Cached.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/hooks/useQuote.test.ts`
Expected: FAIL — the hook calls `stoic.tekloon.net` and has no fallback, so the second and third tests never settle on a bundled quote.

- [ ] **Step 7: Rewrite the hook**

Replace `apps/extension/src/hooks/useQuote.ts` with:

```ts
import type { QuoteData } from '@hub/shared';
import { useEffect, useState } from 'react';
import { QUOTE_ENDPOINT } from '../utils/api';
import { getDailyData, setDailyData } from '../utils/dailyStorage';
import { pickFallbackQuote } from '../utils/quoteFallback';

const CACHE_KEY = 'daily_quote';

const todayIso = () => new Date().toISOString().split('T')[0];

export const useQuote = (): QuoteData => {
  const [quote, setQuote] = useState<QuoteData>(
    () => getDailyData<QuoteData>(CACHE_KEY) ?? pickFallbackQuote(todayIso()),
  );

  useEffect(() => {
    if (getDailyData(CACHE_KEY)) return;

    const fetchQuote = async () => {
      try {
        const res = await fetch(QUOTE_ENDPOINT);
        if (!res.ok) throw new Error(`Quote API error: ${res.status}`);

        const data = (await res.json()) as QuoteData;
        if (!data.text) throw new Error('Quote API returned no text');

        setDailyData(CACHE_KEY, data);
        setQuote(data);
      } catch (error) {
        // The bundled set is already showing; nothing else to do.
        console.error('Quote fetch failed:', error);
      }
    };

    void fetchQuote();
  }, []);

  return quote;
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/extension && pnpm vitest run src/hooks/useQuote.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Update the manifest and the docs**

In `apps/extension/manifest.json`, remove `"https://stoic.tekloon.net/stoic-quote"` from `host_permissions` — the extension no longer contacts it directly.

In `apps/extension/privacy-policy.md`, remove the "Stoic Quote API" bullet from "Third-Party Services" and note under "Hub API" that daily quotes are also fetched through it. In `apps/extension/README.md`, update the External APIs table the same way.

- [ ] **Step 10: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test`

```bash
git add apps/extension/src/utils/quoteFallback.ts apps/extension/src/utils/quoteFallback.test.ts apps/extension/src/hooks/useQuote.ts apps/extension/src/hooks/useQuote.test.ts apps/extension/manifest.json apps/extension/privacy-policy.md apps/extension/README.md
git commit -m "feat(extension): read quotes through the Hub API with a bundled fallback

The widget silently showed one hardcoded quote whenever the upstream
failed. It now goes through the worker's day-cache and rotates a bundled
public-domain set when even that is unreachable."
```

---

### Task 8: Keyboard access for the UI toggle

Double-click is the only way to hide the overlay: not reachable from a keyboard, and nothing announces it exists.

**Files:**
- Create: `apps/extension/src/hooks/useUiVisibility.ts`
- Create: `apps/extension/src/hooks/useUiVisibility.test.ts`
- Modify: `apps/extension/src/App.tsx`
- Modify: `apps/extension/src/i18n/locales/en.json`, `hu.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `useUiVisibility(): { uiVisible: boolean; toggle: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/hooks/useUiVisibility.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const load = async () => (await import('./useUiVisibility')).useUiVisibility;

const press = (key: string, options: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });

describe('useUiVisibility', () => {
  it('starts visible', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    expect(result.current.uiVisible).toBe(true);
  });

  it('hides on the period shortcut', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    press('.');

    expect(result.current.uiVisible).toBe(false);
  });

  it('shows again on a second press', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    press('.');
    press('.');

    expect(result.current.uiVisible).toBe(true);
  });

  it('brings the UI back on Escape but never hides it', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());
    press('.');

    press('Escape');
    expect(result.current.uiVisible).toBe(true);

    press('Escape');
    expect(result.current.uiVisible).toBe(true);
  });

  it('ignores the shortcut while a text field has focus', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    press('.');
    input.remove();

    expect(result.current.uiVisible).toBe(true);
  });

  it('ignores the shortcut when a modifier is held, so browser shortcuts still work', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    press('.', { ctrlKey: true });

    expect(result.current.uiVisible).toBe(true);
  });

  it('stops listening once unmounted', async () => {
    const useUiVisibility = await load();
    const { result, unmount } = renderHook(() => useUiVisibility());
    unmount();

    press('.');

    expect(result.current.uiVisible).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/hooks/useUiVisibility.test.ts`
Expected: FAIL with `Failed to resolve import "./useUiVisibility"`

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/hooks/useUiVisibility.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

/** Focus lives in a field where "." is literal text, not a shortcut. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

/**
 * Shows and hides the dashboard overlay.
 *
 * Double-click still works, but it is undiscoverable and unreachable from a
 * keyboard, so "." toggles and Escape always restores — a user who hid the UI
 * by accident needs one guaranteed way back.
 */
export const useUiVisibility = () => {
  const [uiVisible, setUiVisible] = useState(true);

  const toggle = useCallback(() => setUiVisible((v) => !v), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;

      if (event.key === '.') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'Escape') {
        setUiVisible(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return { uiVisible, toggle };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/hooks/useUiVisibility.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Use it in App and announce the shortcut**

In `App.tsx`, replace `const [uiVisible, setUiVisible] = useState(true);` with `const { uiVisible, toggle } = useUiVisibility();`, change `onDoubleClick={() => setUiVisible(!uiVisible)}` to `onDoubleClick={toggle}`, and remove the now-unused `useState` import if nothing else uses it. Add `import { useUiVisibility } from './hooks/useUiVisibility';`.

Add a hint that fades in with the rest of the UI, inside the content wrapper just before the closing `</div>`:

```tsx
        <p className='absolute bottom-4 right-4 text-[10px] text-white/30 select-none'>
          {t('app.toggleHint')}
        </p>
```

- [ ] **Step 6: Add the locale strings**

`en.json` under `app`: `"toggleHint": "Press . to hide — Esc to bring it back"`.
`hu.json` under `app`: `"toggleHint": "A . elrejti — az Esc visszahozza"`.

- [ ] **Step 7: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test`

```bash
git add apps/extension/src/hooks/useUiVisibility.ts apps/extension/src/hooks/useUiVisibility.test.ts apps/extension/src/App.tsx apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json
git commit -m "feat(extension): add a keyboard shortcut for the UI toggle

Double-click was the only way to hide the overlay: unreachable from a
keyboard and undiscoverable. Escape always restores it."
```

---

### Task 9: Pomodoro focus timer

The `CountdownWidget` already proves the timer pattern. This adds a work/break cycle with a system notification at each transition.

**Files:**
- Create: `apps/extension/src/utils/pomodoro.ts`
- Create: `apps/extension/src/utils/pomodoro.test.ts`
- Create: `apps/extension/src/hooks/usePomodoro.ts`
- Create: `apps/extension/src/hooks/usePomodoro.test.ts`
- Create: `apps/extension/src/components/PomodoroWidget.tsx`
- Modify: `apps/extension/src/hooks/useSettings.ts`
- Modify: `apps/extension/src/popup/TabNav.tsx`, `PopupForm.tsx`
- Modify: `apps/extension/src/App.tsx`
- Modify: `apps/extension/src/test/chromeStub.ts` (add `notifications`)
- Modify: `apps/extension/manifest.json`, `privacy-policy.md`
- Modify: `apps/extension/src/i18n/locales/en.json`, `hu.json`

**Interfaces:**
- Consumes: `isWidgetVisible` and `WidgetId` from `src/widgets.ts` (Task 2); `HubSettings` from Tasks 1–4.
- Produces: `PomodoroPhase`, `nextPhase`, `phaseDurationMs` from `src/utils/pomodoro.ts`; `usePomodoro()` from `src/hooks/usePomodoro.ts`.

- [ ] **Step 1: Write the failing state-machine test**

Create `apps/extension/src/utils/pomodoro.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatRemaining, nextPhase, phaseDurationMs } from './pomodoro';

describe('nextPhase', () => {
  it('follows work with a break', () => {
    expect(nextPhase('work')).toBe('break');
  });

  it('follows a break with work', () => {
    expect(nextPhase('break')).toBe('work');
  });
});

describe('phaseDurationMs', () => {
  it('uses the configured work length', () => {
    expect(phaseDurationMs('work', 25, 5)).toBe(25 * 60 * 1000);
  });

  it('uses the configured break length', () => {
    expect(phaseDurationMs('break', 25, 5)).toBe(5 * 60 * 1000);
  });

  it('refuses a non-positive length and falls back to one minute', () => {
    expect(phaseDurationMs('work', 0, 5)).toBe(60 * 1000);
  });

  it('caps an absurd length at three hours', () => {
    expect(phaseDurationMs('work', 600, 5)).toBe(180 * 60 * 1000);
  });
});

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(formatRemaining(9 * 60 * 1000 + 5000)).toBe('09:05');
  });

  it('formats a value above an hour without dropping the minutes', () => {
    expect(formatRemaining(65 * 60 * 1000)).toBe('65:00');
  });

  it('never formats below zero', () => {
    expect(formatRemaining(-1000)).toBe('00:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/utils/pomodoro.test.ts`
Expected: FAIL with `Failed to resolve import "./pomodoro"`

- [ ] **Step 3: Write the state machine**

Create `apps/extension/src/utils/pomodoro.ts`:

```ts
export type PomodoroPhase = 'work' | 'break';

const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

export const nextPhase = (phase: PomodoroPhase): PomodoroPhase =>
  phase === 'work' ? 'break' : 'work';

/** Clamped so a corrupt or hand-edited setting cannot produce a zero-length timer. */
export const phaseDurationMs = (
  phase: PomodoroPhase,
  workMinutes: number,
  breakMinutes: number,
): number => {
  const raw = phase === 'work' ? workMinutes : breakMinutes;
  const minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(raw) || MIN_MINUTES));
  return minutes * 60 * 1000;
};

export const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/utils/pomodoro.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Extend the chrome stub with notifications**

In `apps/extension/src/test/chromeStub.ts`, add a `notifications` namespace to `chromeStub`:

```ts
    notifications: {
      create: (_id: string, options: unknown) => notifications.push(options),
    },
```

with `const notifications: unknown[] = [];` alongside the other collections, and expose `sentNotifications: () => [...notifications]` on the returned `ChromeStub`.

- [ ] **Step 6: Write the failing hook test**

Create `apps/extension/src/hooks/usePomodoro.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub, type ChromeStub } from '../test/chromeStub';

const load = async () => (await import('./usePomodoro')).usePomodoro;

let chromeStub: ChromeStub;

beforeEach(() => {
  vi.useFakeTimers();
  chromeStub = installChromeStub();
  chromeStub.seedSync({ pomodoroWorkMinutes: 1, pomodoroBreakMinutes: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePomodoro', () => {
  it('starts idle', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());

    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe('work');
  });

  it('counts down while running', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(10_000));

    expect(result.current.remainingMs).toBeLessThanOrEqual(50_000);
    expect(result.current.running).toBe(true);
  });

  it('switches to the break phase when the work phase elapses', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(61_000));

    expect(result.current.phase).toBe('break');
  });

  it('notifies at the phase transition', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(61_000));

    expect(chromeStub.sentNotifications()).toHaveLength(1);
  });

  it('resets back to an idle work phase', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(61_000));

    act(() => result.current.reset());

    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe('work');
  });

  it('stops the interval on unmount', async () => {
    const usePomodoro = await load();
    const { result, unmount } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());

    unmount();

    expect(() => vi.advanceTimersByTime(120_000)).not.toThrow();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run src/hooks/usePomodoro.test.ts`
Expected: FAIL with `Failed to resolve import "./usePomodoro"`

- [ ] **Step 8: Add the settings**

In `useSettings.ts` add `pomodoroWorkMinutes: number;` and `pomodoroBreakMinutes: number;` to `HubSettings`, with `pomodoroWorkMinutes: 25,` and `pomodoroBreakMinutes: 5,` in `DEFAULT_SETTINGS`.

- [ ] **Step 9: Write the hook**

Create `apps/extension/src/hooks/usePomodoro.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from '../i18n/i18n';
import { nextPhase, phaseDurationMs, type PomodoroPhase } from '../utils/pomodoro';
import { useSettings } from './useSettings';

const TICK_MS = 1000;

const notify = (phase: PomodoroPhase) => {
  chrome.notifications.create(`hub-pomodoro-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: i18n.t('pomodoro.notificationTitle'),
    message: i18n.t(phase === 'break' ? 'pomodoro.breakStarted' : 'pomodoro.workStarted'),
  });
};

export const usePomodoro = () => {
  const { settings, isLoaded } = useSettings();
  const [phase, setPhase] = useState<PomodoroPhase>('work');
  const [running, setRunning] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const phaseRef = useRef<PomodoroPhase>('work');

  const durationFor = useCallback(
    (p: PomodoroPhase) =>
      phaseDurationMs(p, settings.pomodoroWorkMinutes, settings.pomodoroBreakMinutes),
    [settings.pomodoroBreakMinutes, settings.pomodoroWorkMinutes],
  );

  // Keep the idle display in step with the configured length.
  useEffect(() => {
    if (!running) setRemainingMs(durationFor(phase));
  }, [durationFor, phase, running]);

  const start = useCallback(() => {
    phaseRef.current = phase;
    setEndsAt(Date.now() + durationFor(phase));
    setRunning(true);
  }, [durationFor, phase]);

  const reset = useCallback(() => {
    setRunning(false);
    setEndsAt(null);
    setPhase('work');
    phaseRef.current = 'work';
  }, []);

  useEffect(() => {
    if (!running || endsAt === null) return;

    const tick = () => {
      const left = endsAt - Date.now();
      if (left > 0) {
        setRemainingMs(left);
        return;
      }

      // Phase elapsed: announce it and roll straight into the next one.
      const upcoming = nextPhase(phaseRef.current);
      phaseRef.current = upcoming;
      notify(upcoming);
      setPhase(upcoming);
      setEndsAt(Date.now() + durationFor(upcoming));
    };

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [durationFor, endsAt, running]);

  return { phase, running, remainingMs, ready: isLoaded, start, reset };
};
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run src/hooks/usePomodoro.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 11: Build the widget**

Create `apps/extension/src/components/PomodoroWidget.tsx`:

```tsx
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePomodoro } from '../hooks/usePomodoro';
import { formatRemaining } from '../utils/pomodoro';

export const PomodoroWidget = () => {
  const { phase, running, remainingMs, ready, start, reset } = usePomodoro();
  const { t } = useTranslation();

  if (!ready) return null;

  return (
    <div className='absolute bottom-8 left-8 flex items-center gap-3 px-4 py-2.5 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl'>
      <div className='flex flex-col'>
        <span className='text-[10px] font-bold uppercase tracking-wider text-white/50'>
          {t(phase === 'work' ? 'pomodoro.work' : 'pomodoro.break')}
        </span>
        <span className='text-2xl font-bold font-variant-numeric leading-none text-white/90'>
          {formatRemaining(remainingMs)}
        </span>
      </div>
      <button
        onClick={start}
        disabled={running}
        className='p-2 rounded-full bg-white/5 hover:bg-white/20 transition-colors disabled:opacity-30'
        title={t('pomodoro.start')}
      >
        {running ? <Pause className='w-4 h-4' /> : <Play className='w-4 h-4' />}
      </button>
      <button
        onClick={reset}
        className='p-2 rounded-full bg-white/5 hover:bg-white/20 transition-colors'
        title={t('pomodoro.reset')}
      >
        <RotateCcw className='w-4 h-4' />
      </button>
    </div>
  );
};
```

- [ ] **Step 12: Mount it and add the popup controls**

In `App.tsx` add `import { PomodoroWidget } from './components/PomodoroWidget';` and render `{show('pomodoro') && <PomodoroWidget />}` next to the other widgets. The `'pomodoro'` id is already in `WIDGET_IDS` from Task 2, so the toggle works with no further change.

In `TabNav.tsx` add a `'pomodoro'` tab (`Timer` icon is already imported for `countdown`; use `Hourglass` from `lucide-react` for this one) with `labelKey: 'popup.tabPomodoro'`.

In `PopupForm.tsx` add two numeric inputs backed by `useState(initialSettings.pomodoroWorkMinutes)` and `useState(initialSettings.pomodoroBreakMinutes)`, include both in the `onSave` object, and render them in the `pomodoro` tab:

```tsx
        {activeTab === 'pomodoro' && (
          <div className='flex flex-col gap-3'>
            <Field id='work' label={t('popup.pomodoroWork')}>
              <input
                id='work'
                type='number'
                min={1}
                max={180}
                value={workMinutes}
                onChange={(e) => setWorkMinutes(Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field id='break' label={t('popup.pomodoroBreak')}>
              <input
                id='break'
                type='number'
                min={1}
                max={180}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>
        )}
```

- [ ] **Step 13: Add the permission, the policy entry and the strings**

`manifest.json`: add `"notifications"` to `permissions`.

`privacy-policy.md`: add a subsection stating that the `notifications` permission is used only to display a local notification when a focus interval ends, that the notification is generated on the device, and that no data leaves it.

`en.json`, new top-level `"pomodoro"`: `work: "Focus"`, `break: "Break"`, `start: "Start"`, `reset: "Reset"`, `notificationTitle: "Hub"`, `workStarted: "Focus time — back to it."`, `breakStarted: "Break time — step away."`. Under `popup`: `tabPomodoro: "Focus"`, `pomodoroWork: "Focus length (minutes)"`, `pomodoroBreak: "Break length (minutes)"`.

`hu.json`, new top-level `"pomodoro"`: `work: "Fókusz"`, `break: "Szünet"`, `start: "Indítás"`, `reset: "Visszaállítás"`, `notificationTitle: "Hub"`, `workStarted: "Fókusz idő — vissza a munkához."`, `breakStarted: "Szünet — állj fel egy kicsit."`. Under `popup`: `tabPomodoro: "Fókusz"`, `pomodoroWork: "Fókusz hossza (perc)"`, `pomodoroBreak: "Szünet hossza (perc)"`.

- [ ] **Step 14: Verify and commit**

Run: `pnpm nx run-many -t typecheck lint test build`

```bash
git add apps/extension/src/utils/pomodoro.ts apps/extension/src/utils/pomodoro.test.ts apps/extension/src/hooks/usePomodoro.ts apps/extension/src/hooks/usePomodoro.test.ts apps/extension/src/components/PomodoroWidget.tsx apps/extension/src/hooks/useSettings.ts apps/extension/src/popup/TabNav.tsx apps/extension/src/popup/PopupForm.tsx apps/extension/src/App.tsx apps/extension/src/test/chromeStub.ts apps/extension/manifest.json apps/extension/privacy-policy.md apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json
git commit -m "feat(extension): add a Pomodoro focus timer

Work and break intervals are configurable, and each transition raises a
local notification so the timer works while another tab is in front."
```

---

## Documentation pass (fold into the last task)

After Task 9, update in the same commit or a follow-up `docs(repo)` commit:

- `CLAUDE.md`: add `widgets.ts` as the single source of widget ids; note that the service worker now also prefetches; note that `localStorage` is unavailable in the worker so prefetch metadata lives in `chrome.storage.local`.
- `apps/extension/README.md`: add the new settings rows (dimming, widget visibility, background source, focus lengths) to the Settings table, add `alarms` and `notifications` to the Permissions table, and add the keyboard shortcut to the feature list.

## Verification Checklist

- [ ] `pnpm nx run-many -t typecheck lint test build` passes on all three projects.
- [ ] Locale parity holds — `src/i18n/validate.ts` fails typecheck if `en.json` and `hu.json` diverge, so a passing typecheck is the proof.
- [ ] `apps/extension/manifest.json` permissions match what `privacy-policy.md` describes: `storage`, `geolocation`, `identity`, `alarms`, `notifications`.
- [ ] No `localStorage` reference in `src/background.ts` or anything it imports transitively (`imageCache`, `prefetch`, `api`).
- [ ] Load `apps/extension/dist/` in Chrome and confirm by hand: the dimming slider, hiding a widget, uploading a custom background, the four-day forecast, the `.`/Escape shortcut, and a Pomodoro transition notification.
