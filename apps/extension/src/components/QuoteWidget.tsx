import { useTranslation } from 'react-i18next';
import { useQuote } from '../hooks/useQuote';

export const QuoteWidget = () => {
  const quote = useQuote();
  const { t } = useTranslation();

  if (!quote) return null;

  return (
    <div className='absolute bottom-5 left-1/2 -translate-x-1/2 text-center max-w-3xl w-full px-6 group cursor-default select-none'>
      <p className='text-xl md:text-2xl font-light text-white/90 drop-shadow-md leading-relaxed tracking-wide italic transition-all duration-500 group-hover:text-white'>
        "{quote.text}"
      </p>
      <div className='overflow-hidden h-auto mt-3 transition-all duration-500 opacity-100'>
        <span className='text-sm font-medium text-white/70 uppercase tracking-widest border-t border-white/20 pt-2 inline-block'>
          {quote.author}
        </span>
      </div>
      {/*
        Rendered only when the source sent one, which is how it doubles as the
        attribution some sources require: Citatum's terms ask for a visible link
        back wherever their quotes appear, and it points at this quote rather
        than the site in general. A source that needs no credit sends no URL and
        gets no line.
      */}
      {quote.sourceUrl && (
        <a
          href={quote.sourceUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='mt-2 inline-block text-[10px] uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors cursor-pointer'
        >
          {t('quote.source')}
        </a>
      )}
    </div>
  );
};
