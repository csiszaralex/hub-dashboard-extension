import type { QuoteData } from '@hub/shared';
import { useEffect, useState } from 'react';
import { quoteRequestUrl } from '../utils/api';
import { getDailyData, setDailyData } from '../utils/dailyStorage';
import { pickFallbackQuote } from '../utils/quoteFallback';
import { useSettings } from './useSettings';
import { useTranslation } from 'react-i18next';

const CACHE_KEY = 'daily_quote';

const todayIso = () => new Date().toISOString().split('T')[0];

export const useQuote = (): QuoteData => {
  const { settings, isLoaded } = useSettings();
  const { i18n } = useTranslation();
  const language = i18n.language?.split('-')[0] || 'en';

  /**
   * What the cached quote was fetched for. `dailyStorage` invalidates on a
   * change, so switching source or category shows the new one immediately
   * rather than tomorrow — the same mechanism the background uses for tags.
   */
  const selection = `${settings.quoteSource}|${language}|${settings.quoteQuery}`;

  const [quote, setQuote] = useState<QuoteData>(
    () => getDailyData<QuoteData>(CACHE_KEY, selection) ?? pickFallbackQuote(todayIso()),
  );

  useEffect(() => {
    // Settings arrive a microtask after first render; fetching before they land
    // would ask for the default source and cache the answer under it.
    if (!isLoaded) return;

    const cached = getDailyData<QuoteData>(CACHE_KEY, selection);
    if (cached) {
      setQuote(cached);
      return;
    }

    const fetchQuote = async () => {
      try {
        const res = await fetch(
          quoteRequestUrl(settings.quoteSource, language, settings.quoteQuery),
        );
        if (!res.ok) throw new Error(`Quote API error: ${res.status}`);

        const data = (await res.json()) as QuoteData;
        if (!data.text) throw new Error('Quote API returned no text');

        setDailyData(CACHE_KEY, data, selection);
        setQuote(data);
      } catch (error) {
        // The bundled set is already showing; nothing else to do.
        console.error('Quote fetch failed:', error);
      }
    };

    void fetchQuote();
  }, [isLoaded, selection, settings.quoteSource, settings.quoteQuery, language]);

  return quote;
};
