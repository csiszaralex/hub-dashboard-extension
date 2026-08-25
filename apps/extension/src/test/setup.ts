import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { installCacheStub } from './cacheStub';
import { installChromeStub } from './chromeStub';

beforeEach(() => {
  // Hooks backed by module-level stores must start each test as they would on a
  // fresh page load, so the registry is cleared and test files import lazily.
  vi.resetModules();
  localStorage.clear();
  installChromeStub();
  installCacheStub();

  // There is no network in a test. Without this default, any component that
  // fetches on mount reaches the real API: the popup's quote-source picker was
  // sending live requests to the production worker on every run, which is slow,
  // fails offline, and leaves happy-dom aborting them at teardown.
  //
  // Rejecting rather than answering, because a test that depends on a response
  // should say so by stubbing `fetch` itself — several already do, and this is
  // overwritten when they do. Anything that does not care sees what an offline
  // browser would show it, which is the state those code paths are written for.
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

  if (typeof URL.createObjectURL !== 'function') {
    let counter = 0;
    URL.createObjectURL = () => `blob:hub-test/${++counter}`;
    URL.revokeObjectURL = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
