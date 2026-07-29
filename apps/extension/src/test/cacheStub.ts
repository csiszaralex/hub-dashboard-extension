/**
 * Minimal in-memory `CacheStorage`. happy-dom does not ship the Cache API, and
 * the background image store depends on it, so tests need a stand-in that
 * behaves like the real thing for `match` / `put` / `delete` / `keys`.
 */
class MemoryCache {
  private entries = new Map<string, Response>();

  async match(request: RequestInfo): Promise<Response | undefined> {
    const stored = this.entries.get(toKey(request));
    return stored ? stored.clone() : undefined;
  }

  async put(request: RequestInfo, response: Response): Promise<void> {
    this.entries.set(toKey(request), response.clone());
  }

  async delete(request: RequestInfo): Promise<boolean> {
    return this.entries.delete(toKey(request));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

const toKey = (request: RequestInfo): string =>
  typeof request === 'string' ? request : request.url;

export const installCacheStub = () => {
  const caches = new Map<string, MemoryCache>();

  (globalThis as unknown as { caches: unknown }).caches = {
    open: async (name: string) => {
      let cache = caches.get(name);
      if (!cache) {
        cache = new MemoryCache();
        caches.set(name, cache);
      }
      return cache;
    },
    delete: async (name: string) => caches.delete(name),
    keys: async () => [...caches.keys()],
    has: async (name: string) => caches.has(name),
  };

  return { cacheNames: () => [...caches.keys()] };
};
