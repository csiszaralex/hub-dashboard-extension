/** In-memory stand-in for the subset of the KV API the worker uses. */
export const createKvStub = () => {
  const store = new Map<string, string>();
  const puts: string[] = [];

  const kv = {
    get: async (key: string, type?: 'json' | 'text') => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
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
  };
};
