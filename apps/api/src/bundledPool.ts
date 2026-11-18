import { PooledPhoto } from './types';

/**
 * Last-resort pool shipped inside the worker, served by `GET /api/background`
 * only when every KV layer is missing or unreadable. Unlike a KV entry it
 * cannot expire, so a deployment with a non-empty list never answers 503 for a
 * background.
 *
 * Deliberately empty for now. Each entry needs real attribution — the
 * photographer's name, their profile URL (with the referral parameters, see
 * `withUtm` in `background.ts`) and the photo's `download_location` — and that
 * data must come from Unsplash itself, never be guessed. An entry with wrong
 * attribution would break the Unsplash API guidelines on every new tab that
 * shows it. The route and `GET /api/health` both treat an empty list as "this
 * layer has nothing", so filling it in is a data change only.
 */
export const BUNDLED_POOL: readonly PooledPhoto[] = [];
