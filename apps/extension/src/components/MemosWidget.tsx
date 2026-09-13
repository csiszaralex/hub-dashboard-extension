import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemos } from '../hooks/useMemos';
import type { MemosFailureReason } from '../utils/memosClient';
import { MemosPanel } from './MemosPanel';

/** How many rows the compact view shows before it starts counting. */
const COMPACT_ROWS = 3;

/**
 * Which translation key explains a given failure.
 *
 * A module-scope lookup rather than building the key at runtime
 * (`memos.error${Capitalized}`): `i18next.d.ts` types `t()` against the
 * literal keys in `en.json`, so a capitalised runtime string is just
 * `string` and would not typecheck. This also means a future
 * `MemosFailureReason` without an entry here fails the build instead of
 * silently falling back to English at render time.
 */
const FAILURE_KEY = {
  auth: 'memos.errorAuth',
  permission: 'memos.errorPermission',
  version: 'memos.errorVersion',
  network: 'memos.errorNetwork',
  server: 'memos.errorServer',
} as const satisfies Record<MemosFailureReason, string>;

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

  if (status === 'loading') return null;

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
        />
      </div>
    );
  }

  const visible = memos.slice(0, COMPACT_ROWS);
  const hidden = memos.length - visible.length;

  return (
    // A fixed minimum height so the compact view does not grow into place: the
    // cache arrives a tick after first paint, and a widget that pushes the
    // corner around on every new tab reads as a glitch.
    <div className={`${wrapper} min-h-24 w-64`}>
      {visible.length === 0 ? (
        <p className='text-xs text-white/30'>{t('memos.empty')}</p>
      ) : (
        visible.map((memo) => (
          <div key={memo.name} className='group flex items-start gap-2 min-w-0 w-full'>
            <button
              onClick={() => void archive(memo.name)}
              title={t('memos.done')}
              className='mt-0.5 shrink-0 w-4 h-4 rounded border border-white/25 flex items-center justify-center text-transparent hover:text-black hover:bg-white hover:border-white transition-colors'
            >
              <Check className='w-3 h-3' />
            </button>
            <button
              onClick={() => setExpanded(true)}
              className='text-left text-sm text-white/70 hover:text-white transition-colors truncate min-w-0 flex-1'
            >
              {memo.snippet}
            </button>
          </div>
        ))
      )}

      <button
        onClick={() => setExpanded(true)}
        className='text-[10px] text-white/35 hover:text-white/70 transition-colors'
      >
        {hidden > 0 ? t('memos.more', { count: hidden }) : t('memos.title')}
      </button>

      {/*
        `network` is the common case — every day spent away from the server —
        so it is a faint line rather than an error. The cache is already on
        screen above it.
      */}
      {failure && <p className='text-[10px] text-white/30'>{t(FAILURE_KEY[failure])}</p>}
    </div>
  );
}
