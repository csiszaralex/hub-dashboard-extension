import { useState } from 'react';
import { type HubSettings } from '../hooks/useSettings';
import { AppearanceSection } from './AppearanceSection';
import { CalendarsSection } from './CalendarsSection';
import { CountdownSection } from './CountdownSection';
import { FocusSection } from './FocusSection';
import { GeneralSection } from './GeneralSection';
import { MemosSection } from './MemosSection';
import { SaveContext, useSaveStatus } from './saveStatus';
import { SaveStatusLine } from './SaveStatusLine';
import { TabNav, type TabId } from './TabNav';
import { WeatherSection } from './WeatherSection';
import { WidgetsSection } from './WidgetsSection';

/**
 * The settings, one tab at a time, each written as it is changed.
 *
 * There is no Apply button. A Chrome popup closes on any click outside it, so
 * edits held back for one were lost without a word, and a few sections (Memos'
 * Connect, the backup import, the Focus session) already acted at once: two
 * save models in one form. Each section now owns its fields and writes them
 * through `SaveContext`, and every outcome lands in the one status line below
 * the tabs, wherever the user is by the time it arrives.
 *
 * `settings` is the live store: a section reads it when it mounts, and its
 * own writes come back through it.
 */
export function PopupForm({
  settings,
  onSave,
}: {
  settings: HubSettings;
  onSave: (settings: Partial<HubSettings>) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<TabId>(
    () => (localStorage.getItem('popup_tab') as TabId | null) ?? 'general',
  );
  const { status, api } = useSaveStatus(onSave);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    localStorage.setItem('popup_tab', tab);
  };

  return (
    <SaveContext.Provider value={api}>
      <div className='flex flex-col gap-3 min-w-0'>
        <TabNav active={activeTab} onChange={handleTabChange} />

        <div>
          {activeTab === 'general' && <GeneralSection settings={settings} onImport={onSave} />}
          {activeTab === 'appearance' && <AppearanceSection settings={settings} />}
          {activeTab === 'weather' && <WeatherSection settings={settings} />}
          {activeTab === 'countdown' && <CountdownSection settings={settings} />}
          {activeTab === 'pomodoro' && <FocusSection settings={settings} />}
          {activeTab === 'calendars' && <CalendarsSection settings={settings} />}
          {activeTab === 'widgets' && <WidgetsSection settings={settings} />}
          {activeTab === 'memos' && <MemosSection url={settings.memosUrl} tag={settings.memosTag} />}
        </div>

        <SaveStatusLine status={status} />
      </div>
    </SaveContext.Provider>
  );
}
