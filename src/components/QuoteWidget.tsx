import { useQuote } from '../hooks/useQuote';

export const QuoteWidget = () => {
  const quote = useQuote();

  if (!quote) return null;

  return (
    <div className='absolute bottom-30 left-1/2 -translate-x-1/2 text-center max-w-3xl w-full px-6 group cursor-default select-none'>
      <p className='text-xl md:text-2xl font-light text-white/90 drop-shadow-md leading-relaxed tracking-wide italic transition-all duration-500 group-hover:text-white'>
        "{quote.text}"
      </p>
      <div className='overflow-hidden h-auto mt-3 transition-all duration-500 opacity-100'>
        <span className='text-sm font-medium text-white/70 uppercase tracking-widest border-t border-white/20 pt-2 inline-block'>
          {quote.author}
        </span>
      </div>
    </div>
  );
};
