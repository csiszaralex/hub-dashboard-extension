import { Check, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type MemoItem, stripTags, tagsExcept } from '../utils/memos';
import type { MemosFailureReason } from '../utils/memosClient';
import {
  failureMessageKey,
  type MemosWriteFailure,
  writeFailureMessageKey,
} from '../utils/memosFailureMessage';

const CHIP = 'shrink-0 px-1.5 py-0.5 rounded-full bg-white/10 text-[10px] text-white/50';

/**
 * A memo's own tags, beside its text.
 *
 * Without `onSelect` they are labels. The compact view uses that: a click on a
 * compact row opens the panel, and a chip that filtered instead would change
 * what is shown with no filter row on screen to say so.
 */

export function MemoTags({ tags, onSelect }: { tags: string[]; onSelect?: (tag: string) => void }) {
  if (tags.length === 0) return null;

  return (
    <span className='flex shrink-0 flex-wrap gap-1'>
      {tags.map((tag) =>
        onSelect ? (
          <button
            key={tag}
            type='button'
            onClick={() => onSelect(tag)}
            className={`${CHIP} hover:bg-white/20 hover:text-white/80 transition-colors`}
          >
            {tag}
          </button>
        ) : (
          <span key={tag} className={CHIP}>
            {tag}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * The archive control.
 *
 * Identical in the compact row and the panel row — the same action on the
 * same data, not two presentations that happen to look alike — so it is one
 * component rather than the same markup and Tailwind classes typed out twice
 * with the risk of the two silently drifting apart.
 */
export function ArchiveButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className='mt-0.5 shrink-0 w-4 h-4 rounded border border-white/25 flex items-center justify-center text-transparent hover:text-black hover:bg-white hover:border-white transition-colors'
    >
      <Check className='w-3 h-3' />
    </button>
  );
}

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
  onRefresh,
  refreshing,
  failure,
  writeFailure,
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
  onRefresh: () => void;
  refreshing: boolean;
  failure: MemosFailureReason | null;
  writeFailure: MemosWriteFailure | null;
}) {
  const { t } = useTranslation();
  const hasRows = memos.length > 0;

  return (
    <div className='w-80 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5'>
        <span className='text-xs font-bold text-white/70 uppercase tracking-widest'>
          {t('memos.title')}
        </span>
        <div className='flex items-center gap-2'>
          {/*
            New tabs use the cache for a few minutes rather than asking twice
            per tab, so this is how a memo written on another device arrives
            before that window is up.
          */}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className='text-white/40 hover:text-white transition-colors disabled:opacity-50'
            title={t('memos.refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onCollapse}
            className='text-white/40 hover:text-white transition-colors'
            title={t('memos.collapse')}
          >
            <X className='w-3.5 h-3.5' />
          </button>
        </div>
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
              {tag}
            </button>
          ))}
        </div>
      )}

      {/*
        Styled through the standard `scrollbar-width` and `scrollbar-color`
        properties, as `WhatsNewModal` does. The `scrollbar-thin` and
        `scrollbar-thumb-*` classes this carried before come from a Tailwind
        plugin this project does not have, so they named nothing and the panel
        fell back to the platform scrollbar: an opaque light-grey bar with a
        solid track, the one piece of unstyled OS chrome in a translucent dark
        interface. The rows keep their own `px-4`, so the bar still sits
        against the panel edge.
      */}
      <div className='max-h-64 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent]'>
        {hasRows ? (
          memos.map((memo) => {
            // The tags come out of the text and back as chips: Memos writes
            // them into the content, and composeContent appends one to
            // everything sent from here, so leaving them in would repeat the
            // filter on every row.
            const text = stripTags(memo.snippet, memo.tags);

            return (
              <div
                key={memo.name}
                className='group flex items-start gap-2 px-4 py-2 hover:bg-white/5 transition-colors'
              >
                <ArchiveButton onClick={() => onArchive(memo.name)} title={t('memos.done')} />
                {text && (
                  <span className='text-sm text-white/80 leading-snug wrap-break-word min-w-0 flex-1'>
                    {text}
                  </span>
                )}
                <MemoTags tags={tagsExcept(memo.tags, activeTag)} onSelect={onTagChange} />
              </div>
            );
          })
        ) : (
          // Suppressed under a failure: "Nothing here" next to a failure line
          // would claim there is genuinely nothing, when the truth is that the
          // request never came back — the failure line below says that instead.
          !failure && <p className='px-4 py-6 text-center text-xs text-white/30'>{t('memos.empty')}</p>
        )}
      </div>

      {/*
        Below the list, above the composer: a failed submit or a failed archive
        must be visibly reported right where the user was just typing, not only
        in the compact view they have since left behind by expanding.
      */}
      {failure && (
        <p className='px-4 py-1.5 text-[10px] text-white/40 border-t border-white/5'>
          {t(failureMessageKey(failure, hasRows))}
        </p>
      )}

      {/*
        The last write the server did not take, on a line of its own: the load's
        line above is often already there on an offline day, so reusing it would
        leave a failed Add looking exactly like nothing happened.
      */}
      {writeFailure && (
        <p className='px-4 py-1.5 text-[10px] text-white/60 border-t border-white/5'>
          {t(writeFailureMessageKey(writeFailure))}
        </p>
      )}

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
            {activeTag}
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
