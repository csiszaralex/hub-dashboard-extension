import type { QuoteData } from '@hub/shared';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  quote: QuoteData;
  loading: boolean;
  onRefresh: () => void;
}

/**
 * Takes the quote rather than fetching it, because `App` also needs the
 * source link for the credits cluster in the corner — and two calls to
 * `useQuote` would be two independent fetches showing two different quotes.
 * The background widget already works this way.
 */
export const QuoteWidget = ({ quote, loading, onRefresh }: Props) => {
  const { t } = useTranslation();

  if (!quote) return null;

  return (
    <div className='text-center max-w-3xl w-full px-6 group cursor-default select-none text-legible'>
      <p className='text-xl md:text-2xl font-light text-white/90 leading-relaxed tracking-wide italic transition-all duration-500 group-hover:text-white'>
        {/* The marks are the language's own: Hungarian opens low, „like this”. */}
        {t('quote.quoted', { text: quote.text })}
      </p>
      <div className='overflow-hidden h-auto mt-3 transition-all duration-500 opacity-100'>
        <span className='text-sm font-medium text-white/70 uppercase tracking-widest border-t border-white/20 pt-2 inline-block'>
          {quote.author}
        </span>
      </div>
      {/*
        The refresh sits with the quote rather than in the corner with the
        background's, because it acts on what is directly above it. It costs no
        upstream call: the worker caches a pool for the day and this walks it.
      */}
      <button
        type='button'
        onClick={onRefresh}
        disabled={loading}
        title={t('quote.refresh')}
        aria-label={t('quote.refresh')}
        className='mt-2 p-1.5 rounded-full text-white/30 hover:text-white/80 hover:bg-white/10 transition-all disabled:opacity-40 cursor-pointer'
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
};
