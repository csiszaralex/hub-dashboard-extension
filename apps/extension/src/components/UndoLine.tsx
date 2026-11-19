// Punctuation, not prose: the same in every language, so not in a locale file.
const SEPARATOR = '·';

/**
 * "Done · Undo": what a destructive click leaves behind for `UNDO_WINDOW_MS`
 * (`utils/undo.ts`), in place of what it removed.
 *
 * The message comes first and the button after it, so the spot a second click
 * of a double-click lands on is plain text: the line takes the place of the
 * control that was clicked, and an Undo button under the pointer would undo
 * the very click the user meant twice. A `status` region, so the change is
 * announced without taking focus away from where the user is.
 */
export function UndoLine({
  message,
  undoLabel,
  undoName,
  onUndo,
  disabled = false,
  className = '',
}: {
  message: string;
  /** The button's visible text. */
  undoLabel: string;
  /** Its accessible name, when several lines can be on screen at once and need telling apart. */
  undoName?: string;
  onUndo: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role='status' className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      <span className='truncate'>{message}</span>
      <span aria-hidden='true'>{SEPARATOR}</span>
      <button
        type='button'
        onClick={onUndo}
        disabled={disabled}
        aria-label={undoName}
        className='shrink-0 font-semibold text-white/80 hover:text-white underline-offset-2 hover:underline transition-colors disabled:opacity-50'
      >
        {undoLabel}
      </button>
    </div>
  );
}
