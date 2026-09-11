import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { hasOriginPermission, requestOriginPermission } from './memosPermissions';

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
});
