import { useId } from 'react';
import { hintId } from './ariaIds';

export const inputCls =
  'w-full min-w-0 px-3 py-2 rounded bg-black/40 border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm';
export const labelCls = 'text-xs font-semibold text-white/60 uppercase tracking-wider';
export const sectionCls = 'bg-white/5 border border-white/5 p-3 rounded-lg flex flex-col gap-2 min-w-0';

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
 */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const groupHintId = useId();

  if (!id) {
    return (
      <fieldset className={sectionCls} aria-describedby={hint ? groupHintId : undefined}>
        <legend className={`${labelCls} float-left w-full`}>{label}</legend>
        {children}
        {hint && (
          <p id={groupHintId} className='text-[10px] text-white/40'>
            {hint}
          </p>
        )}
      </fieldset>
    );
  }

  return (
    <div className={sectionCls}>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId(id)} className='text-[10px] text-white/40'>
          {hint}
        </p>
      )}
    </div>
  );
}
