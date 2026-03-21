import { Edit3, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNote } from '../hooks/useNote';

export const QuickNote = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { note, setNote } = useNote();
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Bezárás, ha kívülre kattintasz (Click Outside logic)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Fókusz a textarea-ra nyitáskor
      setTimeout(() => textareaRef.current?.focus(), 100);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className='absolute bottom-8 right-8 z-30 flex flex-col items-end'>
      {/* --- A JEGYZET PANEL (Animált megjelenés) --- */}
      <div
        className={`
          mb-4 w-80 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 origin-bottom-right
          ${isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4 pointer-events-none absolute'}
        `}
      >
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5'>
          <span className='text-xs font-bold text-white/70 uppercase tracking-widest'>
            Jegyzetek
          </span>
          <button
            onClick={() => setNote('')} // Törlés
            className='text-white/40 hover:text-red-400 transition-colors'
            title='Törlés'
          >
            <Trash2 className='w-3.5 h-3.5' />
          </button>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='Írj valamit mára...'
          className='w-full h-48 bg-transparent text-white p-4 resize-none outline-none font-sans text-sm leading-relaxed placeholder:text-white/20 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent'
          spellCheck={false}
        />
      </div>

      {/* --- LEBEGŐ GOMB (Toggle) --- */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-12 h-12 rounded-full flex items-center justify-center border shadow-lg transition-all duration-300
          ${
            isOpen
              ? 'bg-white text-black rotate-90 border-white'
              : 'bg-black/30 backdrop-blur-md text-white border-white/20 hover:bg-white/10 hover:scale-110'
          }
        `}
      >
        {isOpen ? <X className='w-5 h-5' /> : <Edit3 className='w-5 h-5' />}
      </button>
    </div>
  );
};
