/**
 * `chrome.permissions`, promisified.
 *
 * The host is the user's own server, so it cannot be a build-time
 * `host_permissions` entry. `optional_host_permissions` declares the permitted
 * set and exactly one origin out of it is requested at runtime — a user who
 * never configures the widget grants nothing.
 */
declare const chrome: {
  permissions: {
    contains: (options: { origins: string[] }, cb: (result: boolean) => void) => void;
    request: (options: { origins: string[] }, cb: (granted: boolean) => void) => void;
    remove: (options: { origins: string[] }, cb: (removed: boolean) => void) => void;
  };
};

export const hasOriginPermission = (pattern: string): Promise<boolean> =>
  new Promise((resolve) => chrome.permissions.contains({ origins: [pattern] }, resolve));

/**
 * Must be called straight out of a click handler: Chrome requires a user
 * gesture, and the gesture does not survive an `await`. That is why the popup
 * has its own Connect button rather than hanging this off the shared Save.
 */
export const requestOriginPermission = (pattern: string): Promise<boolean> =>
  new Promise((resolve) => chrome.permissions.request({ origins: [pattern] }, resolve));

/**
 * Hands a server's origin back, when the user disconnects or moves to another
 * server — so the extension does not keep access to a host it no longer uses.
 *
 * Settles with nothing: Chrome's `removed` flag says nothing a caller can act
 * on, and an origin that was never held is already the wanted end state.
 */
export const removeOriginPermission = (pattern: string): Promise<void> =>
  new Promise((resolve) => chrome.permissions.remove({ origins: [pattern] }, () => resolve()));
