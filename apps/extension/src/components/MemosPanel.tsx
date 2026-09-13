import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoItem } from '../utils/memos';

export function MemosPanel({
  memos,
  tags,
  activeTag,
  onTagChange,
  onArchive,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
  onCollapse,
}: {
  memos: MemoItem[];
  tags: string[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  onArchive: (name: string) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className='w-80 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5'>
        <span className='text-xs font-bold text-white/70 uppercase tracking-widest'>
          {t('memos.title')}
        </span>
        <button
          onClick={onCollapse}
          className='text-white/40 hover:text-white transition-colors'
          title={t('memos.collapse')}
        >
          <X className='w-3.5 h-3.5' />
        </button>
      </div>

      {tags.length > 0 && (
        <div className='flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-white/5'>
          <button
            onClick={() => onTagChange(null)}
            className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
              activeTag === null ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {t('memos.all')}
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagChange(tag)}
              className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                activeTag === tag ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
            >
              {`#${tag}`}
            </button>
          ))}
        </div>
      )}

      <div className='max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent'>
        {memos.length === 0 ? (
          <p className='px-4 py-6 text-center text-xs text-white/30'>{t('memos.empty')}</p>
        ) : (
          memos.map((memo) => (
            <div
              key={memo.name}
              className='group flex items-start gap-2 px-4 py-2 hover:bg-white/5 transition-colors'
            >
              <button
                onClick={() => onArchive(memo.name)}
                title={t('memos.done')}
                className='mt-0.5 shrink-0 w-4 h-4 rounded border border-white/25 flex items-center justify-center text-transparent hover:text-black hover:bg-white hover:border-white transition-colors'
              >
                <Check className='w-3 h-3' />
              </button>
              <span className='text-sm text-white/80 leading-snug wrap-break-word min-w-0'>
                {memo.snippet}
              </span>
            </div>
          ))
        )}
      </div>

      {/*
        The composer stays disabled until the server confirms: the id and
        timestamps come from it, and a phantom row that duplicates a moment
        later is worse than a short wait.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className='flex items-center gap-2 px-3 py-2.5 border-t border-white/5 bg-white/5'
      >
        {activeTag && (
          <span className='shrink-0 px-1.5 py-0.5 rounded bg-white/15 text-[10px] text-white/70'>
            {`#${activeTag}`}
          </span>
        )}
        <input
          type='text'
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={t('memos.placeholder')}
          disabled={submitting}
          className='flex-1 min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/25 disabled:opacity-50'
        />
        <button
          type='submit'
          disabled={submitting || !draft.trim()}
          className='shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/60 hover:text-white disabled:opacity-30 transition-colors'
        >
          {submitting ? t('memos.submitting') : t('memos.submit')}
        </button>
      </form>
    </div>
  );
}
