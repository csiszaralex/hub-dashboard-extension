import { isQuoteData, type QuoteData } from '@hub/shared';
import { useEffect, useMemo, useState } from 'react';
import { toLanguage } from '../i18n/language';
import { quoteRequestUrl } from '../utils/api';
import { CUSTOM_QUOTE_SOURCE, pickCustomQuote } from '../utils/customQuotes';
import { getDailyData, setDailyData } from '../utils/dailyStorage';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { pickFallbackQuote } from '../utils/quoteFallback';
import { useSettings } from './useSettings';
import { useTranslation } from 'react-i18next';

const CACHE_KEY = 'daily_quote';

const todayIso = () => new Date().toISOString().split('T')[0];

/** Forgets today's quote; the next load asks the API again. */
export const clearQuoteCache = (): void => localStorage.removeItem(CACHE_KEY);

/**
 * The day's quote, and a way to ask for the next one.
 *
 * **Call this once per page.** It is not a shared store: each caller keeps its
 * own state and its own pool index, and the daily cache it checks is written
 * only after a response arrives — so two instances mounted in the same render
 * both see a miss and both fetch. Measured, not assumed: two consumers produce
 * two requests.
 *
 * Worse than the duplicate request is the divergence once `refresh` is used.
 * Each instance walks its own index, so a second consumer would keep showing —
 * or linking to — the entry the first one has already moved past. That is why
 * `App` owns this and passes the result down, the way it already does for
 * `useBackground`, rather than every consumer calling it.
 *
 * `useSettings` solved the same problem with a module-level store; that is the
 * pattern to reach for if this ever needs more than one consumer.
 */
export const useQuote = () => {
  const { settings, isLoaded } = useSettings();
  const { i18n } = useTranslation();
  const language = toLanguage(i18n.language);

  /**
   * What the cached quote was fetched for. `dailyStorage` invalidates on a
   * change, so switching source or category shows the new one immediately
   * rather than tomorrow — the same mechanism the background uses for tags.
   */
  const selection = `${settings.quoteSource}|${language}|${settings.quoteQuery}`;

  const custom = settings.quoteSource === CUSTOM_QUOTE_SOURCE;

  const [quote, setQuote] = useState<QuoteData>(
    () => getDailyData<QuoteData>(CACHE_KEY, selection) ?? pickFallbackQuote(todayIso()),
  );
  /**
   * Which entry of the day's pool to show. Reset whenever the selection
   * changes, so switching source starts at that source's first quote rather
   * than wherever the previous one had been walked to.
   */
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // The reset happens during render rather than in an effect, so the request
  // effect below never sees the new selection paired with the old index.
  const [indexSelection, setIndexSelection] = useState(selection);
  if (indexSelection !== selection) {
    setIndexSelection(selection);
    setIndex(0);
  }

  // Settings arrive a microtask after first render; acting before they land
  // would ask for the default source and cache the answer under it.
  const requestKey = isLoaded && !custom ? `${selection}#${index}` : null;

  // Only the first entry is worth caching for the day: the rest are what the
  // user asked to see instead of it, and storing them would mean tomorrow
  // opening on whatever they last skipped to.
  const cacheable = index === 0;

  // A cache hit is adopted during render, once per request, for the same
  // reason as the index reset: no extra render pass after the effect. The
  // effect then finds the same entry and makes no request.
  const [cacheCheckedFor, setCacheCheckedFor] = useState<string | null>(null);
  if (cacheCheckedFor !== requestKey) {
    setCacheCheckedFor(requestKey);
    const cached = requestKey && cacheable ? getDailyData<QuoteData>(CACHE_KEY, selection) : null;
    if (cached) setQuote(cached);
  }

  // The user's own list never leaves the browser: no request, no cache entry.
  // Derived rather than stored, so an edit in the popup shows up at once
  // rather than after the daily cache expires. Memoised so the day is read
  // when the list or the position changes, as it was when an effect set it.
  const customQuote = useMemo<QuoteData | null>(
    () =>
      isLoaded && custom
        ? (pickCustomQuote(settings.customQuotes, todayIso(), index) ?? pickFallbackQuote(todayIso()))
        : null,
    [isLoaded, custom, settings.customQuotes, index],
  );

  useEffect(() => {
    if (!requestKey) return;
    if (cacheable && getDailyData<QuoteData>(CACHE_KEY, selection)) return;

    const fetchQuote = async () => {
      try {
        setLoading(true);
        const data = await fetchWithTimeout(
          quoteRequestUrl(settings.quoteSource, language, settings.quoteQuery, index),
          async (res): Promise<QuoteData> => {
            if (!res.ok) throw new Error(`Quote API error: ${res.status}`);
            const body: unknown = await res.json();
            // A malformed body would otherwise be cached for the day.
            if (!isQuoteData(body)) throw new Error('Quote API answered an unexpected shape');
            return body;
          },
        );
        if (!data.text) throw new Error('Quote API returned no text');

        if (cacheable) setDailyData(CACHE_KEY, data, selection);
        setQuote(data);
      } catch (error) {
        // The bundled set is already showing; nothing else to do.
        console.error('Quote fetch failed:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchQuote();
  }, [requestKey, cacheable, index, selection, settings.quoteSource, settings.quoteQuery, language]);

  return {
    quote: customQuote ?? quote,
    loading,
    /** Walks the day's pool. Costs no upstream call — the worker cached it. */
    refresh: () => setIndex((n) => n + 1),
  };
};
