import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import { WIDGET_IDS, type WidgetId } from '../widgets';
import { checkboxCls, labelCls, sectionCls } from './controlStyles';
import { useSave } from './saveStatus';

export function WidgetsSection({ settings }: { settings: HubSettings }) {
  const { t } = useTranslation();
  const { save } = useSave();
  const [hidden, setHidden] = useState<WidgetId[]>(settings.hiddenWidgets);

  const toggle = (id: WidgetId) => {
    const next = hidden.includes(id) ? hidden.filter((w) => w !== id) : [...hidden, id];
    setHidden(next);
    void save({ hiddenWidgets: next });
  };

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
              onChange={() => toggle(id)}
              className={checkboxCls}
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
