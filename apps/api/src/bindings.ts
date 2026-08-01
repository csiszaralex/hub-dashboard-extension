/**
 * The worker's Cloudflare environment. Both route modules run inside the same
 * worker and read the same bindings, so this type lives in one place — two
 * independent declarations would let them drift out of sync with each other
 * and with `wrangler.toml`.
 */
export type Bindings = {
  UNSPLASH_CACHE: KVNamespace;
  UNSPLASH_ACCESS_KEY: string; // secretként van felvéve
};
