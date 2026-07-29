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
