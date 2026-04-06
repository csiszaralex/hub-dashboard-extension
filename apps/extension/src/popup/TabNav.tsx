import { Calendar, Cloud, Globe, Image, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type TabId = 'general' | 'appearance' | 'weather' | 'countdown' | 'calendars';

const TABS = [
  { id: 'general' as const, icon: Globe, labelKey: 'popup.tabGeneral' as const },
  { id: 'appearance' as const, icon: Image, labelKey: 'popup.tabAppearance' as const },
  { id: 'weather' as const, icon: Cloud, labelKey: 'popup.tabWeather' as const },
  { id: 'countdown' as const, icon: Timer, labelKey: 'popup.tabCountdown' as const },
  { id: 'calendars' as const, icon: Calendar, labelKey: 'popup.tabCalendars' as const },
];

export function TabNav({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  const { t } = useTranslation();
  return (
    <nav className='flex rounded-lg overflow-hidden border border-white/10'>
      {TABS.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          type='button'
          onClick={() => onChange(id)}
          className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 transition-colors text-[9px] font-semibold tracking-wide uppercase ${
            active === id
              ? 'bg-white/15 text-white'
              : 'text-white/35 hover:text-white/60 hover:bg-white/5'
          }`}
        >
          <Icon size={14} strokeWidth={active === id ? 2.5 : 1.75} />
          {t(labelKey)}
        </button>
      ))}
    </nav>
  );
}
