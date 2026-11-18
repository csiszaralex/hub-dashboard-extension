type KeyMatch = (key: string) => boolean;

const everyKey: KeyMatch = () => true;

/**
 * In-memory stand-in for the subset of the KV API the worker uses.
 *
 * It models what real KV enforces, not only its happy path: `get` and `put`
 * are network calls that can reject (`failGets` / `failPuts` switch that on,
 * per key if needed), and `put` rejects an `expirationTtl` below 60 seconds,
 * the minimum Workers KV accepts.
 */
export const createKvStub = () => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const puts: string[] = [];
  let failingGets: KeyMatch | null = null;
  let failingPuts: KeyMatch | null = null;

  const kv = {
    get: async (key: string, type?: 'json' | 'text') => {
      if (failingGets?.(key)) throw new Error('KV unavailable');
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      if (failingPuts?.(key)) throw new Error('KV unavailable');
      if (options?.expirationTtl !== undefined && options.expirationTtl < 60) {
        throw new Error('KV put failed: expirationTtl must be at least 60');
      }
      store.set(key, value);
      ttls.set(key, options?.expirationTtl);
      puts.push(key);
    },
  };

  return {
    kv: kv as unknown as KVNamespace,
    seed: (key: string, value: unknown) =>
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value)),
    read: (key: string) => store.get(key),
    keys: () => [...store.keys()],
    putCount: () => puts.length,
    /** The `expirationTtl` the last put of `key` passed, `undefined` for none. */
    ttlOf: (key: string) => ttls.get(key),
    failGets: (match: KeyMatch = everyKey) => {
      failingGets = match;
    },
    failPuts: (match: KeyMatch = everyKey) => {
      failingPuts = match;
    },
  };
};
