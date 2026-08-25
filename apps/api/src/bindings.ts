/**
 * The worker's Cloudflare environment. Both route modules run inside the same
 * worker and read the same bindings, so this type lives in one place — two
 * independent declarations would let them drift out of sync with each other
 * and with `wrangler.toml`.
 */
export type Bindings = {
  UNSPLASH_CACHE: KVNamespace;
  UNSPLASH_ACCESS_KEY: string; // secretként van felvéve

  /**
   * Citatum credentials, both secrets. Their API takes the username and the
   * per-application code as query parameters rather than a header.
   *
   * Optional because the worker has to boot and serve every other source
   * without them: the quote route drops the Citatum source from what it
   * advertises when they are missing, so a deployment without the secrets
   * offers one fewer option instead of failing requests that never wanted it.
   */
  CITATUM_USER?: string;
  CITATUM_KEY?: string;
};
