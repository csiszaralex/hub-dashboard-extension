import type { MemosFailureReason } from './memosClient';

/**
 * Which translation key explains a given failure, for the common case where
 * rows are already on screen (cached or fresh) alongside it.
 *
 * A module-scope lookup rather than building the key at runtime:
 * `i18next.d.ts` types `t()` against the literal keys in `en.json`, so a
 * capitalised runtime string is just `string` and would not typecheck. This
 * also means a future `MemosFailureReason` without an entry here fails the
 * build instead of silently falling back to English at render time.
 *
 * Kept out of `MemosWidget.tsx` and `MemosPanel.tsx` — both are files
 * `eslint-plugin-react-refresh` requires to export only components, so a
 * plain function or const living there fails lint rather than being an
 * available shared helper.
 */
const FAILURE_KEY = {
  auth: 'memos.errorAuth',
  // The widget shows this state as its own prompt with a button; the copy is
  // shared so the two can never drift into saying different things.
  permission: 'memos.accessLost',
  version: 'memos.errorVersion',
  network: 'memos.errorNetwork',
  server: 'memos.errorServer',
} as const satisfies Record<MemosFailureReason, string>;

/**
 * The failure message to show, given whether any rows are on screen.
 *
 * `network` with nothing cached is not "showing cached memos" — there is no
 * cache to show, so that copy would be false. It is the one case that needs
 * its own key; every other reason, and `network` once rows exist, uses the
 * fixed map above. Shared by the compact widget and the panel so the two
 * views cannot drift into disagreeing about which message a given state gets.
 */
export const failureMessageKey = (
  failure: MemosFailureReason,
  hasRows: boolean,
): (typeof FAILURE_KEY)[MemosFailureReason] | 'memos.errorUnreachable' =>
  failure === 'network' && !hasRows ? 'memos.errorUnreachable' : FAILURE_KEY[failure];

/** A submit or an archive the server did not take. Kept apart from the load's failure. */
export interface MemosWriteFailure {
  action: 'submit' | 'archive';
  reason: MemosFailureReason;
}

/**
 * The message for a failed write.
 *
 * Its own line rather than the load's: on an offline day "Showing cached
 * memos" is usually on screen already, so a failed Add reported through it
 * would change nothing the user can see. The copy says what happened to the
 * thing they just did — except for `auth`, where the token is the cause and
 * the one thing they can fix, so that message wins over either action's.
 */
export const writeFailureMessageKey = ({
  action,
  reason,
}: MemosWriteFailure): 'memos.errorAuth' | 'memos.writeFailedSubmit' | 'memos.writeFailedArchive' => {
  if (reason === 'auth') return 'memos.errorAuth';
  return action === 'submit' ? 'memos.writeFailedSubmit' : 'memos.writeFailedArchive';
};
