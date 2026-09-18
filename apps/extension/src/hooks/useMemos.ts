import { useCallback, useEffect, useRef, useState } from 'react';
import { composeContent, filterByTag, type MemoItem, originPattern, tagsOf } from '../utils/memos';
import {
  archiveMemo,
  createMemo,
  getCurrentUser,
  listMemos,
  type MemosCredentials,
  type MemosFailureReason,
} from '../utils/memosClient';
import type { MemosWriteFailure } from '../utils/memosFailureMessage';
import { hasOriginPermission, requestOriginPermission } from '../utils/memosPermissions';
import {
  clearDraft,
  getCachedMemos,
  getCheck,
  getConnectedServer,
  getDraft,
  getToken,
  getUser,
  setCachedMemos,
  setCheck,
  setDraft as persistDraft,
} from '../utils/memosStorage';
import { useSettings } from './useSettings';

/**
 * How long a successful refresh keeps new tabs from asking again.
 *
 * Every new tab would otherwise cost two requests, and people open a lot of
 * tabs. Writes made from the widget land in the cache straight away, so this
 * only delays memos written somewhere else — and the panel's refresh button
 * skips it.
 */
export const MEMOS_FRESH_MS = 5 * 60_000;

/**
 * How long a failed refresh waits before a new tab tries again: short enough
 * that the list recovers soon after the network does, long enough that a day
 * away from the server is not a request per tab.
 */
export const MEMOS_RETRY_MS = 60_000;

/** The local keys a reconnect writes; a change to any means the connection behind the list changed. */
const CREDENTIAL_KEYS = ['memos_server', 'memos_token', 'memos_user'];

/**
 * `off` is no server at all — every user who never set the widget up — and
 * renders nothing. `unconfigured` is a server that is set but has no usable
 * connection on this machine, which takes the popup to sort out.
 *
 * `needs-access` is the narrower case worth telling apart: the connection is
 * whole and only Chrome's host grant is missing. That happens on every reload
 * of an unpacked build, and whenever someone revokes it by hand — and asking
 * for it back needs nothing but a click, since a click on the page is the user
 * gesture `permissions.request` requires.
 */
export type MemosStatus = 'loading' | 'off' | 'unconfigured' | 'needs-access' | 'ready';

/**
 * The Memos widget's data.
 *
 * **Call this once per page.** Like `useQuote` it is not a shared store: each
 * caller keeps its own list, its own active tag and its own draft, so two
 * instances would fetch twice and then disagree the moment either one archived
 * something. `MemosWidget` owns it and passes the result into the panel.
 *
 * Cache first, network behind it — and not on every tab. The new tab page must
 * render before the user's own server answers, and on most days away from that
 * server the cache is the only thing it will ever have.
 */
export const useMemos = () => {
  const { settings, isLoaded } = useSettings();
  const { memosUrl, memosTag } = settings;

  const [all, setAll] = useState<MemoItem[]>([]);
  const [status, setStatus] = useState<MemosStatus>('loading');
  const [failure, setFailure] = useState<MemosFailureReason | null>(null);
  const [writeFailure, setWriteFailure] = useState<MemosWriteFailure | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(memosTag || null);
  const [draft, setDraftState] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Read inside the callbacks rather than captured into them: the token lives
  // outside the settings store, so it is not on any render's props.
  const credentials = useRef<MemosCredentials | null>(null);
  const refreshingRef = useRef(false);
  /** Bumped by every write the server took, so a refresh can tell it is holding older news. */
  const writeEpoch = useRef(0);

  // Bumped when the token or the account changes in local storage, so a tab
  // left open reloads after a reconnect. `forceRef` makes that reload ignore
  // the check, which described the credentials that were just replaced.
  const [reloadKey, setReloadKey] = useState(0);
  const forceRef = useRef(false);

  // A new tab opens on the configured tag, whatever chip the last one ended on.
  // Adjusted during render rather than in an effect — React's documented way to
  // reset state when a prop changes — so the first paint after settings load
  // already carries the right tag instead of flashing unfiltered for a tick.
  const [syncedMemosTag, setSyncedMemosTag] = useState(memosTag);
  if (memosTag !== syncedMemosTag) {
    setSyncedMemosTag(memosTag);
    setActiveTag(memosTag || null);
  }

  /**
   * Asks the server, and commits what it said only if every part of it holds.
   *
   * The token check and the list go out together. `ListMemos` is public, so
   * with an expired token it still answers — with only public memos, usually
   * none of this account's — and trusting that blanked the list and overwrote
   * the offline cache. The list is therefore used only when `auth/me` has
   * vouched for the token in the same refresh; otherwise the cache stands and
   * the failure says why.
   */
  const refreshFromServer = useCallback(
    async (creds: MemosCredentials, isStale: () => boolean) => {
      const epoch = writeEpoch.current;
      const [me, list] = await Promise.all([getCurrentUser(creds), listMemos(creds)]);
      if (isStale()) return;

      // A write that finished while this was in flight knows more than the list
      // does: the list was fetched before it. Committing anyway would put an
      // archived row back, or drop a memo just written — on screen and in the
      // cache, for as long as the check stays fresh. The same in-memory counter
      // the service worker's Pomodoro commands use.
      if (writeEpoch.current !== epoch) return;

      // The connection may also have been cleared or replaced under it, from
      // the popup. Writing the cache back after a disconnect would leave the
      // user's memo contents on disk with nothing to show or remove them.
      const [server, token] = await Promise.all([getConnectedServer(), getToken()]);
      if (server !== creds.baseUrl || token !== creds.token || isStale()) return;

      const now = Date.now();
      const reason = !me.ok ? me.reason : !list.ok ? list.reason : null;
      if (reason || !me.ok || !list.ok) {
        setFailure(reason);
        setStatus('ready');
        void setCheck({ baseUrl: creds.baseUrl, nextAt: now + MEMOS_RETRY_MS, failure: reason });
        return;
      }

      // `ListMemos` answers with every memo this account may *see*, which
      // includes other users' public and protected ones. Each would get an
      // archive control, and a host account can archive them — so they go
      // before anything renders, and before the cache can hold them.
      const own = list.value.filter((memo) => memo.creator === me.value);

      setFailure(null);
      setAll(own);
      setStatus('ready');
      void setCachedMemos(creds.baseUrl, own);
      void setCheck({ baseUrl: creds.baseUrl, nextAt: now + MEMOS_FRESH_MS, failure: null });
    },
    [],
  );

  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !CREDENTIAL_KEYS.some((key) => key in changes)) return;
      forceRef.current = true;
      setReloadKey((key) => key + 1);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    const load = async () => {
      const force = forceRef.current;
      forceRef.current = false;

      if (!memosUrl) {
        credentials.current = null;
        if (!cancelled) setStatus('off');
        return;
      }

      // Checked before the cache is shown. All three are local and near-instant,
      // and a widget that cannot be used must not flash its old rows first.
      // A revoked permission, or a token or account that never made it to this
      // machine, is not a network failure — there is nothing to fetch and
      // nothing to apologise for. Send the user to the popup instead.
      const [granted, server, token, user] = await Promise.all([
        hasOriginPermission(originPattern(memosUrl)),
        getConnectedServer(),
        getToken(),
        getUser(),
      ]);
      if (cancelled) return;
      if (!token || !user) {
        credentials.current = null;
        setStatus('unconfigured');
        return;
      }

      // The token is stored with the server it was issued for, and the two
      // must agree before anything is sent. A different one is a reconnect
      // this tab has only half heard — the token for the new server has
      // landed, the URL has not — and asking now would send that token to the
      // old host. None at all is a token this build cannot place: the settings
      // URL may have been moved by another machine since. Either way the popup
      // is what re-establishes the pair.
      if (server !== memosUrl) {
        credentials.current = null;
        setStatus('unconfigured');
        return;
      }

      if (!granted) {
        credentials.current = null;
        setStatus('needs-access');
        return;
      }

      const creds = { baseUrl: memosUrl, token };
      credentials.current = creds;

      // Both are kept per server: after another machine moves to a different
      // one, what this machine holds describes the old server.
      const [cached, savedDraft, check] = await Promise.all([
        getCachedMemos(memosUrl),
        getDraft(),
        getCheck(memosUrl),
      ]);
      if (cancelled) return;
      setAll(cached);
      // Never over text already in the field: a reload can land while typing.
      if (savedDraft) setDraftState((current) => current || savedDraft);

      if (!force && check && Date.now() < check.nextAt) {
        setFailure(check.failure);
        setStatus('ready');
        return;
      }

      if (cached.length > 0) setStatus('ready');
      await refreshFromServer(creds, () => cancelled);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, memosUrl, reloadKey, refreshFromServer]);

  /**
   * A write the server took proves it is reachable and the token still good,
   * so a failure recorded earlier stops being true — on screen, and in the
   * check, which the next tab would otherwise read the message back out of.
   */
  const noteWriteSucceeded = useCallback(async (baseUrl: string) => {
    setFailure(null);
    const current = await getCheck(baseUrl);
    if (current?.failure) void setCheck({ ...current, failure: null });
  }, []);

  /**
   * A write is often the first thing to notice the server has gone, or that
   * the token has stopped working, and the check is what the next tab reads.
   * Left unrecorded, that tab would render the cache inside a window still
   * saying everything was fine.
   *
   * Only for the two that describe the connection: a `server` failure says
   * something about that one request, not about whether the server is there.
   */
  const noteWriteFailed = useCallback((baseUrl: string, reason: MemosFailureReason) => {
    if (reason !== 'network' && reason !== 'auth') return;
    void setCheck({ baseUrl, nextAt: Date.now() + MEMOS_RETRY_MS, failure: reason });
  }, []);

  /**
   * Asks Chrome for the host grant back, and loads once it is given.
   *
   * Must be called straight from a click handler: `permissions.request` needs
   * a user gesture, and the gesture does not survive an `await` — so the
   * request goes out before anything else here does.
   */
  const grantAccess = useCallback(async () => {
    if (!memosUrl) return;

    const granted = await requestOriginPermission(originPattern(memosUrl));
    if (!granted) return;

    forceRef.current = true;
    setReloadKey((key) => key + 1);
  }, [memosUrl]);

  /** Asks the server now, whatever the check says — the panel's refresh button. */
  const refresh = useCallback(async () => {
    const creds = credentials.current;
    if (!creds || refreshingRef.current) return;

    refreshingRef.current = true;
    setRefreshing(true);
    try {
      // Stale once the credentials it set out with are no longer the current
      // ones — a disconnect or a server switch that landed mid-refresh.
      await refreshFromServer(creds, () => credentials.current !== creds);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refreshFromServer]);

  const setDraft = useCallback((text: string) => {
    setDraftState(text);
    // A draft persisted by a failed send would otherwise come back on every new
    // tab after the user cleared the field — resurrecting text they discarded.
    if (!text.trim()) void clearDraft();
  }, []);

  /**
   * Archives optimistically: the row goes at once and comes back if the server
   * refuses. Safe precisely because archiving is reversible — the worst case
   * here is a row that reappears, not a note that is gone.
   */
  const archive = useCallback(async (name: string) => {
    const creds = credentials.current;
    if (!creds) return;

    const previous = all;
    const next = all.filter((memo) => memo.name !== name);
    setAll(next);
    setWriteFailure(null);

    const result = await archiveMemo(creds, name);
    if (result.ok) {
      writeEpoch.current += 1;
      setWriteFailure(null);
      void setCachedMemos(creds.baseUrl, next);
      void noteWriteSucceeded(creds.baseUrl);
      return;
    }

    setAll(previous);
    setWriteFailure({ action: 'archive', reason: result.reason });
    noteWriteFailed(creds.baseUrl, result.reason);
  }, [all, noteWriteFailed, noteWriteSucceeded]);

  /**
   * Not optimistic: the id and timestamps come from the server, and a phantom
   * row that duplicates half a second later is worse than a brief wait. A
   * failed send keeps its text on screen *and* in local storage, so closing the
   * tab does not throw it away.
   */
  const submit = useCallback(async () => {
    const text = draft.trim();
    const creds = credentials.current;
    if (!text || !creds || submitting) return;

    setWriteFailure(null);
    setSubmitting(true);
    const result = await createMemo(creds, composeContent(text, activeTag));
    setSubmitting(false);

    if (!result.ok) {
      setWriteFailure({ action: 'submit', reason: result.reason });
      noteWriteFailed(creds.baseUrl, result.reason);
      void persistDraft(draft);
      return;
    }

    writeEpoch.current += 1;
    setWriteFailure(null);
    setDraftState('');
    void clearDraft();
    // Computed outside the updater: React double-invokes updaters under
    // StrictMode, and a storage write is not something to do twice.
    const next = [result.value, ...all];
    setAll(next);
    void setCachedMemos(creds.baseUrl, next);
    void noteWriteSucceeded(creds.baseUrl);
  }, [activeTag, all, draft, noteWriteFailed, noteWriteSucceeded, submitting]);

  return {
    status,
    /** Why the last load failed, or null when it did not. Writes never set it. */
    failure,
    /** The last submit or archive the server did not take, until the next one starts. */
    writeFailure,
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
    refresh,
    /** True while `refresh` is waiting on the server. */
    refreshing,
    grantAccess,
  };
};
