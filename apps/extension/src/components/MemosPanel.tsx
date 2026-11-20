import { Check, RefreshCw, X } from 'lucide-react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ArchivedRow,
  type MemoItem,
  memoLabel,
  type MemoRow,
  stripTags,
  tagsExcept,
} from '../utils/memos';
import type { MemosFailureReason } from '../utils/memosClient';
import {
  failureMessageKey,
  type MemosWriteFailure,
  writeFailureMessageKey,
} from '../utils/memosFailureMessage';
import { UndoLine } from './UndoLine';

const CHIP = 'shrink-0 px-1.5 py-0.5 rounded-full bg-white/10 text-2xs text-white/50';

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
export function ArchiveButton({ memo, onClick }: { memo: MemoItem; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    // Named per memo: every row has one, and a screen reader's list of
    // buttons read "Mark done" once per row with nothing to tell them apart.
    <button
      type='button'
      onClick={onClick}
      title={t('memos.done')}
      aria-label={t('memos.doneNamed', { text: memoLabel(memo) })}
      className='mt-0.5 shrink-0 w-4 h-4 rounded border border-white/25 flex items-center justify-center text-transparent hover:text-black hover:bg-white hover:border-white transition-colors'
    >
      <Check className='w-3 h-3' />
    </button>
  );
}

/**
 * An archived memo's row while its undo is on offer: the same slot, so the
 * rows below stay where they were.
 */
export function ArchivedMemoLine({
  row,
  onUndo,
  className,
}: {
  row: ArchivedRow;
  onUndo: (name: string) => void;
  className: string;
}) {
  const { t } = useTranslation();
  return (
    <UndoLine
      message={t('memos.archived')}
      undoLabel={t('memos.undo')}
      undoName={t('memos.undoNamed', { text: memoLabel(row.memo) })}
      onUndo={() => onUndo(row.memo.name)}
      disabled={row.restoring}
      className={className}
    />
  );
}

export function MemosPanel({
  rows,
  tags,
  activeTag,
  onTagChange,
  onArchive,
  onUndo,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
  onCollapse,
  onRefresh,
  refreshing,
  failure,
  writeFailure,
  ref,
}: {
  /** `useMemos`'s `rows`: the memos, with any archived one still in its slot. */
  rows: MemoRow[];
  tags: string[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  onArchive: (name: string) => void;
  onUndo: (name: string) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  onCollapse: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  failure: MemosFailureReason | null;
  writeFailure: MemosWriteFailure | null;
  /** Where `MemosWidget` moves focus when the panel opens. */
  ref?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const hasRows = rows.length > 0;

  return (
    // A named region, focusable from script only, so the focus moved here on
    // expand is announced as "Memos" rather than as whichever control is first.
    <div
      ref={ref}
      role='region'
      aria-label={t('memos.title')}
      tabIndex={-1}
      className='w-80 glass shadow-2xl overflow-hidden flex flex-col'
    >
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
            aria-label={t('memos.refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onCollapse}
            className='text-white/40 hover:text-white transition-colors'
            title={t('memos.collapse')}
            aria-label={t('memos.collapse')}
          >
            <X className='w-3.5 h-3.5' />
          </button>
        </div>
      </div>

      {/*
        A toggle group: the active filter was told apart by colour alone, so
        `aria-pressed` is what tells a screen reader which one is on.
      */}
      {tags.length > 0 && (
        <div
          role='group'
          aria-label={t('memos.tagFilter')}
          className='flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-white/5'
        >
          <button
            type='button'
            aria-pressed={activeTag === null}
            onClick={() => onTagChange(null)}
            className={`px-2 py-0.5 rounded-full text-2xs transition-colors ${
              activeTag === null ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {t('memos.all')}
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              type='button'
              aria-pressed={activeTag === tag}
              onClick={() => onTagChange(tag)}
              className={`px-2 py-0.5 rounded-full text-2xs transition-colors ${
                activeTag === tag ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/*
        `scrollbar-subtle` (index.css), the same scrollbar as `WhatsNewModal`.
        The rows keep their own `px-4`, so the bar still sits against the panel
        edge.
      */}
      <div className='max-h-64 overflow-y-auto scrollbar-subtle'>
        {hasRows ? (
          rows.map((row) => {
            if (row.kind === 'archived') {
              return (
                <div key={row.row.memo.name} className='flex items-start px-4 py-2'>
                  <ArchivedMemoLine
                    row={row.row}
                    onUndo={onUndo}
                    className='text-sm leading-snug text-white/45'
                  />
                </div>
              );
            }

            const { memo } = row;
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
                <ArchiveButton memo={memo} onClick={() => onArchive(memo.name)} />
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
        <p role='alert' className='px-4 py-1.5 text-2xs text-white/40 border-t border-white/5'>
          {t(failureMessageKey(failure, hasRows))}
        </p>
      )}

      {/*
        The last write the server did not take, on a line of its own: the load's
        line above is often already there on an offline day, so reusing it would
        leave a failed Add looking exactly like nothing happened.
      */}
      {writeFailure && (
        <p role='alert' className='px-4 py-1.5 text-2xs text-white/60 border-t border-white/5'>
          {t(writeFailureMessageKey(writeFailure))}
        </p>
      )}

      {/*
        The composer stays disabled until the server confirms: the id and
        timestamps come from it, and a phantom row that duplicates a moment
        later is worse than a short wait.

        The input is named by `aria-label` because a placeholder is not a
        name. It no longer sets `outline-none`, so it shows the global focus
        outline from `index.css`; the form's padding leaves room for it inside
        the panel's `overflow-hidden`.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className='flex items-center gap-2 px-3 py-2.5 border-t border-white/5 bg-white/5'
      >
        {activeTag && (
          <span className='shrink-0 px-1.5 py-0.5 rounded bg-white/15 text-2xs text-white/70'>
            {activeTag}
          </span>
        )}
        <input
          type='text'
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={t('memos.placeholder')}
          aria-label={t('memos.composerLabel')}
          disabled={submitting}
          className='flex-1 min-w-0 bg-transparent text-sm text-white rounded-sm placeholder:text-white/25 disabled:opacity-50'
        />
        <button
          type='submit'
          disabled={submitting || !draft.trim()}
          className='shrink-0 text-2xs font-semibold uppercase tracking-wide text-white/60 hover:text-white disabled:opacity-30 transition-colors'
        >
          {submitting ? t('memos.submitting') : t('memos.submit')}
        </button>
      </form>
    </div>
  );
}
