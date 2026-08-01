import type { QuoteData } from '@hub/shared';
import { useEffect, useState } from 'react';
import { QUOTE_ENDPOINT } from '../utils/api';
import { getDailyData, setDailyData } from '../utils/dailyStorage';
import { pickFallbackQuote } from '../utils/quoteFallback';

const CACHE_KEY = 'daily_quote';

const todayIso = () => new Date().toISOString().split('T')[0];

export const useQuote = (): QuoteData => {
  const [quote, setQuote] = useState<QuoteData>(
    () => getDailyData<QuoteData>(CACHE_KEY) ?? pickFallbackQuote(todayIso()),
  );

  useEffect(() => {
    if (getDailyData(CACHE_KEY)) return;

    const fetchQuote = async () => {
      try {
        const res = await fetch(QUOTE_ENDPOINT);
        if (!res.ok) throw new Error(`Quote API error: ${res.status}`);

        const data = (await res.json()) as QuoteData;
        if (!data.text) throw new Error('Quote API returned no text');

        setDailyData(CACHE_KEY, data);
        setQuote(data);
      } catch (error) {
        // The bundled set is already showing; nothing else to do.
        console.error('Quote fetch failed:', error);
      }
    };

    void fetchQuote();
  }, []);

  return quote;
};
