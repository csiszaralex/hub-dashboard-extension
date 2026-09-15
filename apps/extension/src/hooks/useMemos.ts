import { useCallback, useEffect, useRef, useState } from 'react';
import { composeContent, filterByTag, type MemoItem, originPattern, tagsOf } from '../utils/memos';
import {
  archiveMemo,
  createMemo,
  listMemos,
  type MemosCredentials,
  type MemosFailureReason,
} from '../utils/memosClient';
import { hasOriginPermission } from '../utils/memosPermissions';
import {
  clearDraft,
  getCachedMemos,
  getDraft,
  getToken,
  getUser,
  setCachedMemos,
  setDraft as persistDraft,
} from '../utils/memosStorage';
import { useSettings } from './useSettings';

export type MemosStatus = 'loading' | 'unconfigured' | 'ready';

/**
 * The Memos widget's data.
 *
 * **Call this once per page.** Like `useQuote` it is not a shared store: each
 * caller keeps its own list, its own active tag and its own draft, so two
 * instances would fetch twice and then disagree the moment either one archived
 * something. `MemosWidget` owns it and passes the result into the panel.
 *
 * Cache first, network behind it. The new tab page must render before the
 * user's own server answers — and on most days, when that server is not
 * reachable at all, the cache is the only thing it will ever have.
 */
export const useMemos = () => {
  const { settings, isLoaded } = useSettings();
  const { memosUrl, memosTag } = settings;

  const [all, setAll] = useState<MemoItem[]>([]);
  const [status, setStatus] = useState<MemosStatus>('loading');
  const [failure, setFailure] = useState<MemosFailureReason | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(memosTag || null);
  const [draft, setDraftState] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Read inside the callbacks rather than captured into them: the token lives
  // outside the settings store, so it is not on any render's props.
  const credentials = useRef<MemosCredentials | null>(null);

  // A new tab opens on the configured tag, whatever chip the last one ended on.
  // Adjusted during render rather than in an effect — React's documented way to
  // reset state when a prop changes — so the first paint after settings load
  // already carries the right tag instead of flashing unfiltered for a tick.
  const [syncedMemosTag, setSyncedMemosTag] = useState(memosTag);
  if (memosTag !== syncedMemosTag) {
    setSyncedMemosTag(memosTag);
    setActiveTag(memosTag || null);
  }

  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    const load = async () => {
      if (!memosUrl) {
        credentials.current = null;
        if (!cancelled) setStatus('unconfigured');
        return;
      }

      // Show whatever the last visit stored before anything is asked of the
      // network. One tick, not a round trip.
      const [cached, savedDraft] = await Promise.all([getCachedMemos(), getDraft()]);
      if (cancelled) return;
      if (cached.length > 0) {
        setAll(cached);
        setStatus('ready');
      }
      if (savedDraft) setDraftState(savedDraft);

      // A revoked permission, or a token or account that never made it to this
      // machine, is not a network failure — there is nothing to fetch and
      // nothing to apologise for. Send the user to the popup instead.
      const [granted, token, user] = await Promise.all([
        hasOriginPermission(originPattern(memosUrl)),
        getToken(),
        getUser(),
      ]);
      if (cancelled) return;
      if (!granted || !token || !user) {
        credentials.current = null;
        setStatus('unconfigured');
        return;
      }

      credentials.current = { baseUrl: memosUrl, token };
      const result = await listMemos(credentials.current);
      if (cancelled) return;

      if (!result.ok) {
        setFailure(result.reason);
        // Stay on the cache if there is one; otherwise there is simply nothing
        // to show, which the widget renders as its empty state.
        setStatus('ready');
        return;
      }

      // `ListMemos` answers with every memo this account may *see*, which
      // includes other users' public and protected ones. Each would get an
      // archive control, and a host account can archive them — so they go
      // before anything renders, and before the cache can hold them.
      const own = result.value.filter((memo) => memo.creator === user);

      setFailure(null);
      setAll(own);
      setStatus('ready');
      void setCachedMemos(own);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, memosUrl]);

  const setDraft = useCallback((text: string) => {
    setDraftState(text);
  }, []);

  /**
   * Archives optimistically: the row goes at once and comes back if the server
   * refuses. Safe precisely because archiving is reversible — the worst case
   * here is a row that reappears, not a note that is gone.
   */
  const archive = useCallback(async (name: string) => {
    if (!credentials.current) return;

    const previous = all;
    const next = all.filter((memo) => memo.name !== name);
    setAll(next);

    const result = await archiveMemo(credentials.current, name);
    if (result.ok) {
      setFailure(null);
      void setCachedMemos(next);
      return;
    }

    setAll(previous);
    setFailure(result.reason);
  }, [all]);

  /**
   * Not optimistic: the id and timestamps come from the server, and a phantom
   * row that duplicates half a second later is worse than a brief wait. A
   * failed send keeps its text on screen *and* in local storage, so closing the
   * tab does not throw it away.
   */
  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || !credentials.current || submitting) return;

    setSubmitting(true);
    const result = await createMemo(credentials.current, composeContent(text, activeTag));
    setSubmitting(false);

    if (!result.ok) {
      setFailure(result.reason);
      void persistDraft(draft);
      return;
    }

    setFailure(null);
    setDraftState('');
    void clearDraft();
    setAll((current) => {
      const next = [result.value, ...current];
      void setCachedMemos(next);
      return next;
    });
  }, [activeTag, draft, submitting]);

  return {
    status,
    /** Why the last call failed, or null when it did not. */
    failure,
    /** Already narrowed to `activeTag`. */
    memos: filterByTag(all, activeTag),
    /** Every tag in the fetched set — the chips. */
    tags: tagsOf(all),
    activeTag,
    setActiveTag,
    draft,
    setDraft,
    submit,
    submitting,
    archive,
  };
};
