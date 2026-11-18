import { RefreshCw, Settings } from 'lucide-react';
import { useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BackgroundInfo } from './components/BackgroundInfo';
import { CalendarWidget } from './components/CalendarWidget';
import { Clock } from './components/Clock';
import { CountdownWidget } from './components/CountdownWidget';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MemosWidget } from './components/MemosWidget';
import { PomodoroWidget } from './components/PomodoroWidget';
import { QuickNote } from './components/QuickNote';
import { QuoteWidget } from './components/QuoteWidget';
import { WeatherWidget } from './components/WeatherWidget';
import { WhatsNewModal } from './components/WhatsNewModal';
import { useBackground } from './hooks/useBackground';
import { useQuote } from './hooks/useQuote';
import { useSettings } from './hooks/useSettings';
import { useUiVisibility } from './hooks/useUiVisibility';
import { useWhatsNew } from './hooks/useWhatsNew';
import { countEntries, LONG_RELEASE_ENTRIES, releasesSince } from './utils/changelog';
import { dimToOpacity } from './utils/dim';
import { isWidgetVisible, type WidgetId } from './widgets';

function App() {
  const { settings, isLoaded } = useSettings();
  const showWidget = (id: WidgetId) => isWidgetVisible(settings.hiddenWidgets, id);
  const { bgData, imageSrc, refreshBackground, loading: bgLoading } = useBackground();
  const { uiVisible, toggle } = useUiVisibility();
  const { shouldShow, currentVersion, lastSeenVersion, dismiss } = useWhatsNew();
  const { quote, refresh: refreshQuote, loading: quoteLoading } = useQuote();
  const { t } = useTranslation();

  // Counted out here rather than inside the modal: the clock and the quote are
  // siblings of that slot, not children of it. Over the same range the modal
  // will render, not the whole injected changelog — a user one small release
  // behind should not have the dashboard blanked for two lines of fixes.
  const hidesBackdrop =
    shouldShow &&
    countEntries(releasesSince(__CHANGELOG__, lastSeenVersion, currentVersion)) >=
      LONG_RELEASE_ENTRIES;

  // The double-click toggle belongs to the background only. Bubbling up from a
  // widget it fired on every double-click inside one: selecting a word in the
  // note or the Memos composer hid the whole UI, and a double-clicked Memos
  // checkbox archived two rows and hid it too. `main` is the target when the UI
  // is hidden (the layer is `pointer-events-none` then); the layer is the
  // target for a click on the photo between the widgets.
  const layerRef = useRef<HTMLDivElement>(null);
  const toggleFromBackground = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget || event.target === layerRef.current) toggle();
  };

  if (!isLoaded) {
    return <div className='w-screen h-screen bg-black' />;
  }

  return (
    <main
      className='relative w-screen h-screen flex flex-col items-center justify-center text-white bg-black bg-cover bg-center transition-all duration-1000 overflow-hidden'
      style={{
        backgroundImage: imageSrc ? `url(${imageSrc})` : undefined,
      }}
      onDoubleClick={toggleFromBackground}
    >
      <div
        className='absolute inset-0 bg-black pointer-events-none transition-opacity duration-1000'
        style={{ opacity: uiVisible ? dimToOpacity(settings.backgroundDim) : 0 }}
      />

      <div
        ref={layerRef}
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
          {/*
            Every widget sits in its own boundary, inside its `showWidget`
            condition, so one that throws vanishes and the rest stay. A failed
            release-notes modal also dismisses itself: left showing, an empty
            slot would keep the countdown, the timer and, for a long release,
            the clock and quote off the page.
          */}
          {shouldShow ? (
            <ErrorBoundary name='WhatsNewModal' onError={dismiss}>
              <WhatsNewModal
                version={currentVersion}
                lastSeenVersion={lastSeenVersion}
                onClose={dismiss}
              />
            </ErrorBoundary>
          ) : (
            <>
              {showWidget('countdown') && (
                <ErrorBoundary name='CountdownWidget'>
                  <CountdownWidget />
                </ErrorBoundary>
              )}
              {showWidget('pomodoro') && (
                <ErrorBoundary name='PomodoroWidget'>
                  <PomodoroWidget />
                </ErrorBoundary>
              )}
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
            {showWidget('clock') && (
              <ErrorBoundary name='Clock'>
                <Clock />
              </ErrorBoundary>
            )}
            {showWidget('quote') && (
              <ErrorBoundary name='QuoteWidget'>
                <QuoteWidget quote={quote} loading={quoteLoading} onRefresh={refreshQuote} />
              </ErrorBoundary>
            )}
          </div>
        )}

        {showWidget('calendar') && (
          <ErrorBoundary name='CalendarWidget'>
            <CalendarWidget />
          </ErrorBoundary>
        )}
        {showWidget('weather') && (
          <ErrorBoundary name='WeatherWidget'>
            <WeatherWidget />
          </ErrorBoundary>
        )}
        {/* If uncomment add topSites to manifest.json */}
        {/* <TopSitesWidget /> */}
        {showWidget('note') && (
          <ErrorBoundary name='QuickNote'>
            <QuickNote />
          </ErrorBoundary>
        )}
        {showWidget('memos') && (
          <ErrorBoundary name='MemosWidget'>
            <MemosWidget />
          </ErrorBoundary>
        )}

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
          {/*
            The settings live behind the toolbar action, which Chrome keeps in
            the extensions menu until the user pins it, so the page offers its
            own way in. `options_ui` in the manifest opens the same page in a tab.
          */}
          <button
            type='button'
            onClick={() => void chrome.runtime.openOptionsPage()}
            className='p-2 rounded-full bg-black/20 hover:bg-white/20 backdrop-blur-sm transition-all group'
            title={t('app.openSettings')}
            aria-label={t('app.openSettings')}
          >
            <Settings className='w-4 h-4 text-white/70 group-hover:text-white' />
          </button>
          {showWidget('backgroundInfo') && (
            <ErrorBoundary name='BackgroundInfo'>
              <BackgroundInfo data={bgData} />
            </ErrorBoundary>
          )}
          {/*
            The quote's credit joins the photo's in this corner, so both
            attributions read as one thing rather than one of them floating
            under the quote. Deliberately a sibling of `BackgroundInfo` and not
            a child: that widget can be switched off, and taking Citatum's link
            down with it would break the terms their quotes are served under.
          */}
          {quote.sourceUrl && (
            <a
              href={quote.sourceUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-xs text-white/60 hover:text-white transition-colors cursor-pointer'
            >
              {t('quote.source')}
            </a>
          )}
        </div>

        <p className='absolute bottom-4 right-4 text-[10px] text-white/30 select-none'>
          {t('app.toggleHint')}
        </p>
      </div>
    </main>
  );
}

export default App;
