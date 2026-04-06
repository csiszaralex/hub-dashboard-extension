import { useTranslation } from 'react-i18next';
import { labelCls, sectionCls } from './Field';

export interface CalendarListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
}

export function CalendarsSection({
  availableCals,
  selectedCals,
  calError,
  onToggle,
  onLogin,
}: {
  availableCals: CalendarListEntry[];
  selectedCals: string[];
  calError: string | null;
  onToggle: (id: string) => void;
  onLogin: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${sectionCls} gap-3`}>
      <div className='flex justify-between items-center'>
        <span className={labelCls}>{t('popup.calendars')}</span>
        <button
          type='button'
          onClick={onLogin}
          className='text-[10px] font-medium bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded transition-colors shrink-0'
        >
          {t('popup.googleLogin')}
        </button>
      </div>
      {calError && (
        <p className='text-[10px] text-red-400 bg-red-500/10 p-2 rounded'>{calError}</p>
      )}
      {availableCals.length > 0 ? (
        <div className='flex flex-col gap-0.5 min-w-0'>
          {availableCals.map((cal) => (
            <label
              key={cal.id}
              className='flex items-center gap-2.5 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-md transition-colors min-w-0'
            >
              <input
                type='checkbox'
                checked={selectedCals.includes(cal.id)}
                onChange={() => onToggle(cal.id)}
                className='accent-white/70 w-3.5 h-3.5 rounded border-white/20 bg-zinc-900 cursor-pointer shrink-0'
              />
              <div
                className='w-2.5 h-2.5 rounded-full shrink-0'
                style={{ backgroundColor: cal.backgroundColor || '#ccc' }}
              />
              <span className='text-sm text-white/90 truncate select-none min-w-0 flex-1'>
                {cal.summary}
              </span>
            </label>
          ))}
        </div>
      ) : (
        !calError && (
          <p className='text-[10px] text-white/40 italic'>{t('popup.loadingCalendars')}</p>
        )
      )}
    </div>
  );
}
