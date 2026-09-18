import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import {
  hasOriginPermission,
  removeOriginPermission,
  requestOriginPermission,
} from './memosPermissions';

describe('memosPermissions', () => {
  it('reports an origin that was never granted as absent', async () => {
    installChromeStub();
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(false);
  });

  it('reports a granted origin as present', async () => {
    const stub = installChromeStub();
    stub.grantOrigins(['https://memo.example.com/*']);
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(true);
  });

  it('grants on request', async () => {
    installChromeStub();
    await expect(requestOriginPermission('https://memo.example.com/*')).resolves.toBe(true);
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(true);
  });

  // Chrome shows a prompt and the user can say no. A stub that always granted
  // would mean the refusal path never executes under test.
  it('resolves false when the user refuses, leaving nothing granted', async () => {
    const stub = installChromeStub();
    stub.denyPermissionRequests();
    await expect(requestOriginPermission('https://memo.example.com/*')).resolves.toBe(false);
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(false);
  });

  // Chrome rejects a pattern with no path component outright.
  it('rejects a match pattern with no path', async () => {
    installChromeStub();
    await expect(requestOriginPermission('https://memo.example.com')).rejects.toThrow(
      /Invalid value for origin/,
    );
  });

  // Chrome refuses any origin not covered by optional_host_permissions, which
  // is how a typo'd scheme or a forgotten manifest entry surfaces.
  it('rejects an origin outside optional_host_permissions', async () => {
    installChromeStub();
    await expect(requestOriginPermission('http://memo.example.com/*')).rejects.toThrow(
      /must be listed in the extension manifest/,
    );
  });

  // contains shares the same shape validation as request — a malformed
  // pattern throws no matter which of the two asks.
  it('rejects a malformed pattern passed to hasOriginPermission', async () => {
    installChromeStub();
    await expect(hasOriginPermission('https://memo.example.com')).rejects.toThrow(
      /Invalid value for origin/,
    );
  });

  // Unlike request, contains does not check optional_host_permissions
  // membership: it is a plain query, and Chrome answers false for an origin
  // the extension doesn't hold rather than throwing.
  it('resolves false, not a throw, for a well-formed origin outside optional_host_permissions', async () => {
    installChromeStub();
    await expect(hasOriginPermission('http://memo.example.com/*')).resolves.toBe(false);
  });

  // Disconnecting, or switching to another server, hands the old origin back —
  // otherwise the extension keeps access to a server the user left.
  it('releases a granted origin', async () => {
    const stub = installChromeStub();
    stub.grantOrigins(['https://memo.example.com/*']);
    await removeOriginPermission('https://memo.example.com/*');
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(false);
  });

  it('leaves other granted origins alone', async () => {
    const stub = installChromeStub();
    stub.grantOrigins(['https://memo.example.com/*', 'https://other.example.com/*']);
    await removeOriginPermission('https://memo.example.com/*');
    await expect(hasOriginPermission('https://other.example.com/*')).resolves.toBe(true);
  });

  it('settles quietly for an origin that was never granted', async () => {
    installChromeStub();
    await expect(removeOriginPermission('https://memo.example.com/*')).resolves.toBeUndefined();
  });

  it('rejects a malformed pattern passed to removeOriginPermission', async () => {
    installChromeStub();
    await expect(removeOriginPermission('https://memo.example.com')).rejects.toThrow(
      /Invalid value for origin/,
    );
  });
});
