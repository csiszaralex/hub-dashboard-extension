export const inputCls =
  'w-full min-w-0 px-3 py-2 rounded bg-black/40 border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm';
export const labelCls = 'text-xs font-semibold text-white/60 uppercase tracking-wider';
export const sectionCls = 'bg-white/5 border border-white/5 p-3 rounded-lg flex flex-col gap-2 min-w-0';

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
  return (
    <div className={sectionCls}>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && <p className='text-[10px] text-white/40'>{hint}</p>}
    </div>
  );
}
