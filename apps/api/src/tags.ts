export const DEFAULT_TAGS = 'landscape,forest,mountain,fog,nature view';

/** Beyond a handful of tags the Unsplash query gets no better, but the cache key space grows. */
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 32;

/**
 * Reduces a free-text tag list to a canonical form.
 *
 * The result is the KV cache key, so anything that varies without changing the
 * meaning of the search — order, casing, spacing, punctuation — has to be
 * normalised away, otherwise every variant spends a fresh Unsplash API call.
 */
export const normalizeTags = (raw: string): string => {
  const tags = raw
    .split(',')
    .map((tag) =>
      tag
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TAG_LENGTH),
    )
    .filter(Boolean);

  return [...new Set(tags)].sort().slice(0, MAX_TAGS).join(',');
};

const DEFAULT_NORMALIZED = normalizeTags(DEFAULT_TAGS);

/**
 * The tags a request actually searches for.
 *
 * Falls back to the defaults both when no tags were given and when the given
 * ones normalise to nothing (`?tags=@@@`), so those requests share the default
 * pool instead of creating a duplicate of it under a second key.
 */
export const resolveTags = (raw: string | undefined): string =>
  normalizeTags(raw ?? '') || DEFAULT_NORMALIZED;

export const poolKey = (tags: string): string => `pool:${tags}`;

export const DEFAULT_POOL_KEY = poolKey(DEFAULT_NORMALIZED);
