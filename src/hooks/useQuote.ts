import { useEffect, useState } from 'react';
import { getDailyData, setDailyData } from '../utils/dailyStorage';

interface QuoteData {
  text: string;
  author: string;
}

const CACHE_KEY = 'daily_quote';

const DEFAULT_QUOTE: QuoteData = {
  text: 'First, solve the problem. Then, write the code.',
  author: 'John Johnson',
};

export const useQuote = () => {
  // JAVÍTÁS: Lazy init itt is
  const [quote, setQuote] = useState<QuoteData>(() => {
    const cached = getDailyData<QuoteData>(CACHE_KEY);
    return cached || DEFAULT_QUOTE;
  });

  useEffect(() => {
    if (getDailyData(CACHE_KEY)) return;

    const fetchQuote = async () => {
      try {
        const res = await fetch('https://stoic.tekloon.net/stoic-quote');
        const json = await res.json();

        // JAVÍTÁS: A te API válaszod alapján 'json.data.quote' kell
        const newQuote: QuoteData = {
          text: json.data.quote, // Itt volt a hiba
          author: json.data.author,
        };

        setDailyData(CACHE_KEY, newQuote);
        setQuote(newQuote);
      } catch (error) {
        console.error('Quote fetch error', error);
      }
    };

    fetchQuote();
  }, []);

  return quote;
};
