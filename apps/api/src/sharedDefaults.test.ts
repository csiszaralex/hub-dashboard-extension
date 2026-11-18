import { DEFAULT_BACKGROUND_TAGS, DEFAULT_QUOTE_SOURCE_ID } from '@hub/shared';
import { describe, expect, it } from 'vitest';
import type { Bindings } from './bindings';
import { resolveSource } from './quoteSources';
import { normalizeTags, resolveTags } from './tags';

// The extension sends these same constants until the user picks their own, so
// the worker's defaults have to be read from `@hub/shared` rather than declared
// here a second time, where they could drift apart unnoticed.
describe('defaults shared with the extension', () => {
  it('searches the shared default tags when a request names none', () => {
    expect(resolveTags(undefined)).toBe(normalizeTags(DEFAULT_BACKGROUND_TAGS));
  });

  it('serves the shared default quote source for an unknown id', () => {
    expect(resolveSource('no-such-source', {} as Bindings).id).toBe(DEFAULT_QUOTE_SOURCE_ID);
    expect(resolveSource(undefined, {} as Bindings).id).toBe(DEFAULT_QUOTE_SOURCE_ID);
  });
});
