import type { QuoteData } from '@hub/shared';
import { useEffect, useState } from 'react';
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

  useEffect(() => setIndex(0), [selection]);

  useEffect(() => {
    // Settings arrive a microtask after first render; fetching before they land
    // would ask for the default source and cache the answer under it.
    if (!isLoaded) return;

    // The user's own list never leaves the browser: no request, no cache entry,
    // and it re-reads on every edit so a change in the popup shows up at once
    // rather than after the daily cache expires.
    if (custom) {
      setQuote(
        pickCustomQuote(settings.customQuotes, todayIso(), index) ?? pickFallbackQuote(todayIso()),
      );
      return;
    }

    // Only the first entry is worth caching for the day: the rest are what the
    // user asked to see instead of it, and storing them would mean tomorrow
    // opening on whatever they last skipped to.
    const cached = index === 0 ? getDailyData<QuoteData>(CACHE_KEY, selection) : null;
    if (cached) {
      setQuote(cached);
      return;
    }

    const fetchQuote = async () => {
      try {
        setLoading(true);
        const data = await fetchWithTimeout(
          quoteRequestUrl(settings.quoteSource, language, settings.quoteQuery, index),
          async (res): Promise<QuoteData> => {
            if (!res.ok) throw new Error(`Quote API error: ${res.status}`);
            return res.json();
          },
        );
        if (!data.text) throw new Error('Quote API returned no text');

        if (index === 0) setDailyData(CACHE_KEY, data, selection);
        setQuote(data);
      } catch (error) {
        // The bundled set is already showing; nothing else to do.
        console.error('Quote fetch failed:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchQuote();
  }, [isLoaded, custom, index, selection, settings.customQuotes, settings.quoteSource, settings.quoteQuery, language]);

  return {
    quote,
    loading,
    /** Walks the day's pool. Costs no upstream call — the worker cached it. */
    refresh: () => setIndex((n) => n + 1),
  };
};
