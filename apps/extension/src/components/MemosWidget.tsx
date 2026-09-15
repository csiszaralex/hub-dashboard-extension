import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemos } from '../hooks/useMemos';
import { failureMessageKey, writeFailureMessageKey } from '../utils/memosFailureMessage';
import { ArchiveButton, MemosPanel } from './MemosPanel';

/** How many rows the compact view shows before it starts counting. */
const COMPACT_ROWS = 3;

/**
 * The Memos widget.
 *
 * Compact by default — a few borderless lines that do not compete with the
 * wallpaper — and the full panel in the same spot once expanded. Each compact
 * row carries its own archive control: ticking the top item off is the reason
 * the widget exists and must not cost an expand first.
 */
export function MemosWidget() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const {
    status,
    failure,
    writeFailure,
    memos,
    tags,
    activeTag,
    setActiveTag,
    draft,
    setDraft,
    submit,
    submitting,
    archive,
  } = useMemos();

  // No server set is the widget switched off, not a prompt: nearly every user
  // never configures it, and a nudge on every new tab would be theirs forever.
  if (status === 'loading' || status === 'off') return null;

  const wrapper = 'absolute bottom-20 left-8 z-20 flex flex-col items-start gap-2';

  if (status === 'unconfigured') {
    return (
      <div className={wrapper}>
        <p className='text-xs text-white/35 max-w-56'>{t('memos.unconfigured')}</p>
      </div>
    );
  }

  if (expanded) {
    return (
      <div className={wrapper}>
        <MemosPanel
          memos={memos}
          tags={tags}
          activeTag={activeTag}
          onTagChange={setActiveTag}
          onArchive={(name) => void archive(name)}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={() => void submit()}
          submitting={submitting}
          onCollapse={() => setExpanded(false)}
          failure={failure}
          writeFailure={writeFailure}
        />
      </div>
    );
  }

  const visible = memos.slice(0, COMPACT_ROWS);
  const hidden = memos.length - visible.length;
  const hasRows = memos.length > 0;

  return (
    // A fixed minimum height so the compact view does not grow into place: the
    // cache arrives a tick after first paint, and a widget that pushes the
    // corner around on every new tab reads as a glitch.
    <div className={`${wrapper} min-h-24 w-64`}>
      {hasRows ? (
        visible.map((memo) => (
          <div key={memo.name} className='group flex items-start gap-2 min-w-0 w-full'>
            <ArchiveButton onClick={() => void archive(memo.name)} title={t('memos.done')} />
            <button
              onClick={() => setExpanded(true)}
              className='text-left text-sm text-white/70 hover:text-white transition-colors truncate min-w-0 flex-1'
            >
              {memo.snippet}
            </button>
          </div>
        ))
      ) : (
        // Suppressed under a failure: "Nothing here" next to "Can't reach your
        // Memos server" would be a contradiction, since the truth is that
        // nothing has come back yet, not that the list is genuinely empty.
        !failure && <p className='text-xs text-white/30'>{t('memos.empty')}</p>
      )}

      <button
        onClick={() => setExpanded(true)}
        className='text-[10px] text-white/35 hover:text-white/70 transition-colors'
      >
        {hidden > 0 ? t('memos.more', { count: hidden }) : t('memos.title')}
      </button>

      {/*
        One line for whichever failure applies, chosen by the same helper the
        panel uses so the two views cannot disagree about which message a
        given state gets. `network` with nothing cached gets its own copy —
        "showing cached memos" would assert a cache that does not exist.
      */}
      {failure && (
        <p className='text-[10px] text-white/30'>{t(failureMessageKey(failure, hasRows))}</p>
      )}

      {/*
        Archive is available from these rows, so its failure is reported here
        too — on its own line, since the load's line may already be showing.
      */}
      {writeFailure && (
        <p className='text-[10px] text-white/50'>{t(writeFailureMessageKey(writeFailure))}</p>
      )}
    </div>
  );
}
