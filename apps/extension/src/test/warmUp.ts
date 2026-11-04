import { beforeAll } from 'vitest';
import { installChromeStub } from './chromeStub';

/**
 * How long the one cold load of a module graph may take. The cost is Vite
 * transforming every file the graph reaches, which a loaded machine stretches
 * well past the 20-second test timeout.
 */
const WARM_UP_TIMEOUT_MS = 180_000;

/**
 * Loads a module graph once before the file's tests run, outside their timeout.
 *
 * Tests import their subject inside the test, after `setup.ts`'s
 * `vi.resetModules()`, so the first one used to pay for transforming the whole
 * graph — every widget and locale file, for `App` — against its own timeout,
 * and timed out whenever the machine was busy. `resetModules` discards the
 * evaluated modules, not Vite's transforms, so each test still gets fresh
 * module state; only the one-off compile moves here.
 *
 * Runs before `setup.ts`'s `beforeEach`, so it installs the `chrome` stub
 * itself: loading `i18n` reaches for `chrome` straight away.
 */
export const warmUp = (load: () => Promise<unknown>): void => {
  beforeAll(async () => {
    installChromeStub();
    await load();
  }, WARM_UP_TIMEOUT_MS);
};
