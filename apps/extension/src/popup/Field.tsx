import { useId } from 'react';
import { hintId } from './ariaIds';
import { errorCls, hintCls, labelCls, sectionCls } from './controlStyles';

/**
 * One setting: a label, its control, and an optional hint below.
 *
 * With `id`, the label points at that one control, and the hint carries the
 * id `hintId(id)` names, which the control (the caller's child, so only the
 * caller can reach it) references with `aria-describedby`. Without `id` there
 * is no single control to point at (a radio group, a pair of buttons), so the field
 * is a `fieldset` named by its `legend` instead of a `<label>` that labels
 * nothing. The legend is floated because a fieldset draws a non-floated legend
 * into its top border, and this one has to sit in the flex column like the
 * label does.
 *
 * `error` takes the hint's place, under the same id so the control's
 * description follows it, in the error style rather than the hint's.
 * `announceError` makes it an alert; leave it off when the message also goes
 * to the status line through `useSave().report`, which announces it already,
 * and a second alert would read it twice.
 */
export function Field({
  id,
  label,
  hint,
  error,
  announceError = false,
  children,
}: {
  id?: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  announceError?: boolean;
  children: React.ReactNode;
}) {
  const groupHintId = useId();
  const describedById = id ? hintId(id) : groupHintId;

  // Keyed apart so an error is a new element rather than the hint's `<p>`
  // reused: an alert is announced when it is inserted, not reliably when an
  // existing node gains the role.
  const description = error ? (
    <p key='error' id={describedById} role={announceError ? 'alert' : undefined} className={errorCls}>
      {error}
    </p>
  ) : (
    hint && (
      <p key='hint' id={describedById} className={hintCls}>
        {hint}
      </p>
    )
  );

  if (!id) {
    return (
      <fieldset className={sectionCls} aria-describedby={error || hint ? groupHintId : undefined}>
        <legend className={`${labelCls} float-left w-full`}>{label}</legend>
        {children}
        {description}
      </fieldset>
    );
  }

  return (
    <div className={sectionCls}>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      {children}
      {description}
    </div>
  );
}
