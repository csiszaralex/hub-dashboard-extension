import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

/** Every non-test source file, as text. */
const SOURCES = import.meta.glob<string>(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./test/**'],
  { query: '?raw', import: 'default', eager: true },
);

/**
 * Every host a module that makes requests names, minus reserved `.invalid`
 * hosts, which are cache keys (`CUSTOM_IMAGE_KEY`) and are never fetched.
 * A request to a host missing from `host_permissions` fails in Chrome with a
 * CORS error while every test here, which fakes `fetch`, stays green.
 */
const requestedHosts = (): Map<string, string> => {
  const hosts = new Map<string, string>();
  for (const [file, code] of Object.entries(SOURCES)) {
    if (!/\bfetch(WithTimeout)?\(/.test(code)) continue;
    for (const [, host] of code.matchAll(/https:\/\/([a-z0-9.-]+)/g)) {
      if (host && !host.endsWith('.invalid')) hosts.set(host, file);
    }
  }
  return hosts;
};

const isCovered = (host: string) =>
  manifest.host_permissions.some((pattern) => {
    const granted = pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '');
    return granted.startsWith('*.') ? host.endsWith(granted.slice(1)) : host === granted;
  });

describe('manifest host permissions', () => {
  it('cover every host the extension requests', () => {
    const missing = [...requestedHosts()].filter(([host]) => !isCovered(host));
    expect(missing).toEqual([]);
  });

  it('finds the hosts it is meant to check', () => {
    // Guards the scan itself: if it stopped matching, the test above would
    // pass on an empty list.
    expect([...requestedHosts().keys()]).toEqual(
      expect.arrayContaining(['api.open-meteo.com', 'www.googleapis.com']),
    );
  });
});
