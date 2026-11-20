import { RefreshCw, Settings } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
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
import { WelcomeCard } from './components/WelcomeCard';
import { WhatsNewModal } from './components/WhatsNewModal';
import { useBackground } from './hooks/useBackground';
import { useQuote } from './hooks/useQuote';
import { useSettings } from './hooks/useSettings';
import { useUiVisibility } from './hooks/useUiVisibility';
import { useWhatsNew } from './hooks/useWhatsNew';
import { CHANGELOG, countEntries, LONG_RELEASE_ENTRIES, releasesSince } from './utils/changelog';
import { dimToOpacity } from './utils/dim';
import { isWidgetVisible, type WidgetId } from './widgets';

/** The named areas of the layout shell, laid out by `shell-stack` and `shell-grid` (index.css). */
type ShellArea =
  | 'calendar'
  | 'top'
  | 'weather'
  | 'clock'
  | 'memos'
  | 'quote'
  | 'note'
  | 'credits'
  | 'hint';

/**
 * One cell of the layout shell. It stretches over its whole grid area and
 * places its widget inside itself, so most of a cell is photo: `data-shell`
 * is what lets the double-click toggle count that as background.
 * `empty:hidden` drops a cell whose widget rendered nothing, so the narrow
 * column keeps no gap for it.
 */
const Cell = ({
  area,
  className,
  children,
}: {
  area: ShellArea;
  className: string;
  children?: ReactNode;
}) => (
  <div data-shell={area} style={{ gridArea: area }} className={`empty:hidden ${className}`}>
    {children}
  </div>
);

function App() {
  const { settings, isLoaded } = useSettings();
  const showWidget = (id: WidgetId) => isWidgetVisible(settings.hiddenWidgets, id);
  const { bgData, imageSrc, refreshBackground, loading: bgLoading } = useBackground();
  const { uiVisible, toggle } = useUiVisibility();
  const { announcement, currentVersion, lastSeenVersion, dismiss } = useWhatsNew();
  const showsReleaseNotes = announcement === 'releaseNotes';
  const { quote, refresh: refreshQuote, loading: quoteLoading } = useQuote();
  const { t } = useTranslation();

  // Counted out here rather than inside the modal: the clock and the quote are
  // siblings of that slot, not children of it. Over the same range the modal
  // will render, not the whole injected changelog — a user one small release
  // behind should not have the dashboard blanked for two lines of fixes. The
  // welcome card never hides them: it is short by design.
  const hidesBackdrop =
    showsReleaseNotes &&
    countEntries(releasesSince(CHANGELOG, lastSeenVersion, currentVersion)) >=
      LONG_RELEASE_ENTRIES;

  // The double-click toggle belongs to the background only. Bubbling up from a
  // widget it fired on every double-click inside one: selecting a word in the
  // note or the Memos composer hid the whole UI, and a double-clicked Memos
  // checkbox archived two rows and hid it too. `main` is the target when the UI
  // is hidden (the layer is `pointer-events-none` then); for a click on the
  // photo between the widgets it is one of the shell's own boxes (the layer,
  // the narrow column, the footer or a cell), each marked with `data-shell`.
  const toggleFromBackground = (event: MouseEvent<HTMLElement>) => {
    const { target } = event;
    const onShell = target instanceof HTMLElement && target.dataset.shell !== undefined;
    if (target === event.currentTarget || onShell) toggle();
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
      {/*
        Scrims behind the two bands of text that sit straight on the photo:
        the clock and countdown at the top, the quote and credits at the
        bottom. The uniform dim above is the user's to set, down to zero, and a
        bright sky or snow field then leaves white text on near-white. These
        stay with the UI and fade out with it when it is hidden.
      */}
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-48 bg-linear-to-b from-black/35 to-transparent pointer-events-none transition-opacity duration-1000 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-64 bg-linear-to-t from-black/45 to-transparent pointer-events-none transition-opacity duration-1000 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}
      />

      {/*
        `inert` while hidden: the fade only made the widgets invisible, so Tab
        still walked through every control and a screen reader still read the
        whole dashboard. It also blocks pointer input, as `pointer-events-none`
        does, so the double-click target above is unchanged.

        The layout shell. Below `wide` (index.css) the layer is a column: the
        widgets scroll in the first box and the credits stay in the second.
        From `wide` up both boxes are `display: contents`, their cells become
        the layer's own grid items and `shell-grid` places them. The DOM order
        is the wide layout's reading order, top row to bottom, left to right,
        so Tab and a screen reader walk it the way it looks there. The layer
        scrolls as a last resort, when a short window cannot fit every row.
      */}
      <div
        data-shell='layer'
        inert={!uiVisible}
        className={`
          relative z-10 w-full h-full flex flex-col transition-all duration-700 ease-in-out
          wide:grid wide:shell-grid wide:gap-y-4 wide:px-edge wide:pt-edge wide:pb-4 wide:overflow-y-auto wide:overflow-x-hidden scrollbar-subtle
          ${uiVisible ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-sm scale-105 pointer-events-none'}
        `}
      >
        <div
          data-shell='stack'
          className='flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-subtle grid shell-stack content-center-safe gap-6 px-4 pt-10 pb-6 wide:contents'
        >
          <Cell area='calendar' className='flex items-start justify-center wide:justify-start'>
            {showWidget('calendar') && (
              <ErrorBoundary name='CalendarWidget'>
                <CalendarWidget />
              </ErrorBoundary>
            )}
          </Cell>

          {/*
            The top slot: the countdown, the focus timer, or one of the two
            announcements in their place. `pt-2` keeps it at the 2.5rem from
            the top it had as an absolutely positioned bar.
          */}
          <Cell
            area='top'
            className='flex flex-wrap items-start content-start justify-center gap-4 wide:pt-2'
          >
            {/*
              Every widget sits in its own boundary, inside its `showWidget`
              condition, so one that throws vanishes and the rest stay. A failed
              release-notes modal also dismisses itself: left showing, an empty
              slot would keep the countdown, the timer and, for a long release,
              the clock and quote off the page.
            */}
            {showsReleaseNotes ? (
              <ErrorBoundary name='WhatsNewModal' onError={dismiss}>
                <WhatsNewModal
                  version={currentVersion}
                  lastSeenVersion={lastSeenVersion}
                  onClose={dismiss}
                />
              </ErrorBoundary>
            ) : announcement === 'welcome' ? (
              <ErrorBoundary name='WelcomeCard' onError={dismiss}>
                <WelcomeCard onClose={dismiss} />
              </ErrorBoundary>
            ) : (
              <>
                {/*
                  The two timer cards are fixed-width rows that cannot wrap, so
                  in a window narrower than the card (estimated from its
                  classes: about 32rem for the countdown, 23rem for the timer,
                  plus the column's padding) they are zoomed down to fit
                  rather than clipped. `zoom`, not `scale`: it shrinks the box
                  the column lays out, too.
                */}
                {showWidget('countdown') && (
                  <div className='empty:hidden max-[34rem]:[zoom:0.6]'>
                    <ErrorBoundary name='CountdownWidget'>
                      <CountdownWidget />
                    </ErrorBoundary>
                  </div>
                )}
                {showWidget('pomodoro') && (
                  <div className='empty:hidden max-[25rem]:[zoom:0.8]'>
                    <ErrorBoundary name='PomodoroWidget'>
                      <PomodoroWidget />
                    </ErrorBoundary>
                  </div>
                )}
              </>
            )}
          </Cell>

          <Cell area='weather' className='flex items-start justify-center wide:justify-end'>
            {showWidget('weather') && (
              <ErrorBoundary name='WeatherWidget'>
                <WeatherWidget />
              </ErrorBoundary>
            )}
          </Cell>

          {/*
            The clock and the quote both step aside for a long release. The
            modal is glass like everything else here, and glass over a nine-rem
            white clock is unreadable — the alternative was an opaque panel,
            which would be the one solid surface in an interface built entirely
            out of translucent ones. Hiding the two things it actually covers
            keeps the style intact.

            Only for a long one: a patch release with two entries makes a modal
            barely taller than the countdown that normally sits in this slot,
            and blanking the dashboard for it would be theatre. The threshold
            counts entries rather than measuring height, so it reads the same
            at every viewport size and zoom level.
          */}
          <Cell area='clock' className='flex items-center justify-center'>
            {!hidesBackdrop && showWidget('clock') && (
              <ErrorBoundary name='Clock'>
                <Clock />
              </ErrorBoundary>
            )}
          </Cell>

          <Cell area='memos' className='flex items-end justify-center wide:justify-start'>
            {showWidget('memos') && (
              <ErrorBoundary name='MemosWidget'>
                <MemosWidget />
              </ErrorBoundary>
            )}
          </Cell>

          <Cell area='quote' className='flex items-end justify-center'>
            {!hidesBackdrop && showWidget('quote') && (
              <ErrorBoundary name='QuoteWidget'>
                <QuoteWidget quote={quote} loading={quoteLoading} onRefresh={refreshQuote} />
              </ErrorBoundary>
            )}
          </Cell>

          {/* If uncomment add topSites to manifest.json */}
          {/* <TopSitesWidget /> */}
          <Cell area='note' className='flex items-end justify-center wide:justify-end'>
            {showWidget('note') && (
              <ErrorBoundary name='QuickNote'>
                <QuickNote />
              </ErrorBoundary>
            )}
          </Cell>
        </div>

        {/*
          The credits and the hint. Below `wide` a bar under the scrolling
          column, so the attributions stay on screen however far it scrolls.
          From `wide` up the bottom row of the grid; the negative margins keep
          both at the 1rem inset they had as absolutely positioned corners,
          half the widgets' `edge`.
        */}
        <div
          data-shell='footer'
          className='flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-4 pt-2 pb-4 wide:contents'
        >
          <Cell area='credits' className='flex flex-wrap items-end gap-3 min-w-0 text-legible wide:-ml-4'>
            {/* HÁTTÉR FRISSÍTŐ GOMB — a custom background has no rotating pool to refresh */}
            {settings.backgroundSource !== 'custom' && (
              <button
                onClick={() => void refreshBackground()}
                disabled={bgLoading}
                className='p-2 rounded-full bg-black/20 hover:bg-white/20 backdrop-blur-sm transition-all disabled:opacity-50 group'
                title={t('app.newBackground')}
                aria-label={t('app.newBackground')}
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
          </Cell>

          <Cell area='hint' className='flex items-end justify-end wide:-mr-4'>
            <p className='text-2xs text-white/50 select-none text-legible'>{t('app.toggleHint')}</p>
          </Cell>
        </div>
      </div>
    </main>
  );
}

export default App;
