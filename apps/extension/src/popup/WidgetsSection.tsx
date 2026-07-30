import { useTranslation } from 'react-i18next';
import { WIDGET_IDS, type WidgetId } from '../widgets';
import { labelCls, sectionCls } from './Field';

export function WidgetsSection({
  hidden,
  onToggle,
}: {
  hidden: WidgetId[];
  onToggle: (id: WidgetId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${sectionCls} gap-3`}>
      <span className={labelCls}>{t('popup.widgets')}</span>
      <div className='flex flex-col gap-0.5 min-w-0'>
        {WIDGET_IDS.map((id) => (
          <label
            key={id}
            className='flex items-center gap-2.5 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-md transition-colors min-w-0'
          >
            <input
              type='checkbox'
              checked={!hidden.includes(id)}
              onChange={() => onToggle(id)}
              className='accent-white/70 w-3.5 h-3.5 rounded border-white/20 bg-zinc-900 cursor-pointer shrink-0'
            />
            <span className='text-sm text-white/90 truncate select-none min-w-0 flex-1'>
              {t(`widgets.${id}`)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
