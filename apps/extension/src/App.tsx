import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackgroundInfo } from './components/BackgroundInfo';
import { CalendarWidget } from './components/CalendarWidget';
import { Clock } from './components/Clock';
import { CountdownWidget } from './components/CountdownWidget';
import { PomodoroWidget } from './components/PomodoroWidget';
import { QuickNote } from './components/QuickNote';
import { QuoteWidget } from './components/QuoteWidget';
import { WeatherWidget } from './components/WeatherWidget';
import { WhatsNewModal } from './components/WhatsNewModal';
import { useBackground } from './hooks/useBackground';
import { useSettings } from './hooks/useSettings';
import { useUiVisibility } from './hooks/useUiVisibility';
import { useWhatsNew } from './hooks/useWhatsNew';
import { countEntries, LONG_RELEASE_ENTRIES } from './utils/changelog';
import { dimToOpacity } from './utils/dim';
import { isWidgetVisible, type WidgetId } from './widgets';

function App() {
  const { settings, isLoaded } = useSettings();
  const showWidget = (id: WidgetId) => isWidgetVisible(settings.hiddenWidgets, id);
  const { bgData, imageSrc, refreshBackground, loading: bgLoading } = useBackground();
  const { uiVisible, toggle } = useUiVisibility();
  const { shouldShow, currentVersion, dismiss } = useWhatsNew();
  const { t } = useTranslation();

  // Read straight from the injected changelog rather than from the modal: the
  // clock and the quote are siblings of that slot, not children of it, so the
  // decision has to be made out here where both are rendered.
  const hidesBackdrop = shouldShow && countEntries(__CHANGELOG__) >= LONG_RELEASE_ENTRIES;

  if (!isLoaded) {
    return <div className='w-screen h-screen bg-black' />;
  }

  return (
    <main
      className='relative w-screen h-screen flex flex-col items-center justify-center text-white bg-black bg-cover bg-center transition-all duration-1000 overflow-hidden'
      style={{
        backgroundImage: imageSrc ? `url(${imageSrc})` : undefined,
      }}
      onDoubleClick={toggle}
    >
      <div
        className='absolute inset-0 bg-black pointer-events-none transition-opacity duration-1000'
        style={{ opacity: uiVisible ? dimToOpacity(settings.backgroundDim) : 0 }}
      />

      <div
        className={`
          relative z-10 w-full h-full flex flex-col items-center justify-center transition-all duration-700 ease-in-out
          ${uiVisible ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-sm scale-105 pointer-events-none'}
        `}
      >
        {/* FELSŐ KÖZÉPSŐ SÁV - Visszaszámláló / Pomodoro / Frissítés */}
        {/*
          `z-20` because `QuoteWidget` is absolutely positioned too and sits
          later in this list: two positioned siblings both at `z-index: auto`
          are painted in DOM order, so the quote was drawn over the release
          notes modal that shares this slot. Hiding the quote below settles
          that particular collision on its own; this stays as the general rule,
          since the top slot should win against anything that reaches it and
          the countdown and focus timer live here too.
        */}
        <div className='absolute top-10 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-start justify-center gap-4 max-w-[calc(100vw-40rem)]'>
          {shouldShow ? (
            <WhatsNewModal version={currentVersion} onClose={dismiss} />
          ) : (
            <>
              {showWidget('countdown') && <CountdownWidget />}
              {showWidget('pomodoro') && <PomodoroWidget />}
            </>
          )}
        </div>

        {/*
          Both step aside for a long release. The modal is glass like everything
          else here, and glass over a nine-rem white clock is unreadable — the
          alternative was an opaque panel, which would be the one solid surface
          in an interface built entirely out of translucent ones. Hiding the two
          things it actually covers keeps the style intact.

          Only for a long one: a patch release with two entries makes a modal
          barely taller than the countdown that normally sits in this slot, and
          blanking the dashboard for it would be theatre. The threshold counts
          entries rather than measuring height, so it reads the same at every
          viewport size and zoom level.
        */}
        {!hidesBackdrop && (
          <div className='flex flex-col items-center gap-6 mb-10'>
            {showWidget('clock') && <Clock />}
            {showWidget('quote') && <QuoteWidget />}
          </div>
        )}

        {showWidget('calendar') && <CalendarWidget />}
        {showWidget('weather') && <WeatherWidget />}
        {/* If uncomment add topSites to manifest.json */}
        {/* <TopSitesWidget /> */}
        {showWidget('note') && <QuickNote />}

        {/* ALSÓ SÁV */}
        <div className='absolute bottom-4 left-4 flex items-end gap-3'>
          {/* HÁTTÉR FRISSÍTŐ GOMB — a custom background has no rotating pool to refresh */}
          {settings.backgroundSource !== 'custom' && (
            <button
              onClick={() => refreshBackground()}
              disabled={bgLoading}
              className='p-2 rounded-full bg-black/20 hover:bg-white/20 backdrop-blur-sm transition-all disabled:opacity-50 group'
              title={t('app.newBackground')}
            >
              <RefreshCw
                className={`w-4 h-4 text-white/70 group-hover:text-white ${bgLoading ? 'animate-spin' : ''}`}
              />
            </button>
          )}
          {showWidget('backgroundInfo') && <BackgroundInfo data={bgData} />}
        </div>

        <p className='absolute bottom-4 right-4 text-[10px] text-white/30 select-none'>
          {t('app.toggleHint')}
        </p>
      </div>
    </main>
  );
}

export default App;
