import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub } from './test/chromeStub';
import { warmUp } from './test/warmUp';

warmUp(() => Promise.all([import('./i18n/i18n'), import('./App')]));

const QUOTE_WITH_SOURCE = {
  text: 'Üres fejjel lehet megélni, üres gyomorral nem.',
  author: 'Móra Ferenc',
  sourceUrl: 'https://www.citatum.hu/idezet/5073',
};

const QUOTE_WITHOUT_SOURCE = { text: 'Be one.', author: 'Marcus Aurelius' };

const serveQuote = (quote: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/quote')) return new Response(JSON.stringify(quote));
      // Everything else the dashboard reaches for on mount — background,
      // weather, calendar — behaves as it does offline.
      return Promise.reject(new TypeError('Failed to fetch'));
    }),
  );

/**
 * Citatum's terms make the link back a condition of serving their quotes, so
 * these live at the App level: the link moved out of `QuoteWidget` into the
 * credits cluster, and losing its test in the move is exactly how a
 * contractual requirement disappears quietly.
 */
describe('App — quote attribution', () => {
  beforeEach(() => {
    installChromeStub();
  });

  it('credits the quote source in the corner when the source requires it', async () => {
    serveQuote(QUOTE_WITH_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;

    render(<App />);

    const link = await waitFor(() => screen.getByRole('link', { name: 'Source' }));
    expect(link.getAttribute('href')).toBe('https://www.citatum.hu/idezet/5073');
  });

  it('shows no credit for a source that needs none', async () => {
    serveQuote(QUOTE_WITHOUT_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;

    render(<App />);

    await waitFor(() => expect(screen.getByText(/Be one\./)).not.toBeNull());
    expect(screen.queryByText('Source')).toBeNull();
  });

  it('keeps the credit when the photo credit widget is switched off', async () => {
    // The whole reason it is a sibling of `BackgroundInfo` rather than a child:
    // hiding the photo credit must not take Citatum's link down with it.
    installChromeStub().seedSync({ hiddenWidgets: ['backgroundInfo'] });
    serveQuote(QUOTE_WITH_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;

    render(<App />);

    expect(await waitFor(() => screen.getByRole('link', { name: 'Source' }))).not.toBeNull();
  });
});

describe('App — settings entry point', () => {
  it('opens the settings from the page', async () => {
    const chromeStub = installChromeStub();
    serveQuote(QUOTE_WITHOUT_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;

    render(<App />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Settings' })));

    expect(chromeStub.optionsPageOpens()).toBe(1);
  });
});

describe('App — first run', () => {
  // `setup.ts` starts every test with empty `localStorage` and sync storage:
  // exactly a first install.
  const renderFirstRun = async () => {
    const chromeStub = installChromeStub();
    serveQuote(QUOTE_WITHOUT_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;
    render(<App />);
    const welcome = await screen.findByRole('region', { name: 'Welcome to Hub' });
    return { chromeStub, welcome };
  };

  it('welcomes a new user beside the dashboard instead of showing release notes', async () => {
    await renderFirstRun();

    expect(screen.queryByRole('dialog')).toBeNull();
    // Non-blocking: the quote, which a long release would hide, stays.
    await waitFor(() => expect(screen.getByText(/Be one\./)).not.toBeNull());
  });

  it("opens the settings from the welcome's button", async () => {
    const { chromeStub } = await renderFirstRun();

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(chromeStub.optionsPageOpens()).toBe(1);
  });

  it('closes the welcome with its button', async () => {
    await renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: 'Close welcome' }));
    expect(screen.queryByRole('region', { name: 'Welcome to Hub' })).toBeNull();
  });

  it('closes the welcome with Escape, but not the press that brings the UI back', async () => {
    await renderFirstRun();

    // Trying the shortcut the card teaches must not take the card away.
    fireEvent.keyDown(window, { key: '.' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Welcome to Hub' })).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Welcome to Hub' })).toBeNull();
    expect(localStorage.getItem('hub_last_seen_version')).toBe(__APP_VERSION__);
  });
});

describe('App — double-click toggle', () => {
  beforeEach(() => {
    installChromeStub();
  });

  /** The layer that fades out when the UI is hidden: `main`'s positioned (`relative`) child. */
  const renderApp = async () => {
    serveQuote(QUOTE_WITHOUT_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText(/Be one\./)).not.toBeNull());
    const main = container.querySelector('main') as HTMLElement;
    const layer = main.querySelector(':scope > .relative') as HTMLElement;
    const hidden = () => layer.className.includes('opacity-0');
    return { main, layer, hidden };
  };

  it('hides and restores the UI on a double-click on the background', async () => {
    const { main, layer, hidden } = await renderApp();

    fireEvent.doubleClick(layer);
    expect(hidden()).toBe(true);

    // Hidden, the layer takes no pointer events, so the click lands on `main`.
    fireEvent.doubleClick(main);
    expect(hidden()).toBe(false);
  });

  it('leaves the UI alone for a double-click inside a widget', async () => {
    const { hidden } = await renderApp();

    // Selecting a word in the quote is the case that used to hide everything.
    fireEvent.doubleClick(screen.getByText(/Be one\./));
    expect(hidden()).toBe(false);
  });
});

describe('App — hidden UI', () => {
  beforeEach(() => {
    installChromeStub();
  });

  // Faded out is not gone: without `inert` Tab still walked through every
  // invisible control and a screen reader still read the whole dashboard.
  it('takes the hidden widgets out of reach, and gives them back', async () => {
    serveQuote(QUOTE_WITHOUT_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;

    render(<App />);
    const settings = await waitFor(() => screen.getByRole('button', { name: 'Settings' }));
    expect(settings.closest('[inert]')).toBeNull();

    fireEvent.keyDown(window, { key: '.' });
    expect(settings.closest('[inert]')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(settings.closest('[inert]')).toBeNull();
  });

  it('names the icon-only controls on the page', async () => {
    serveQuote(QUOTE_WITHOUT_SOURCE);
    await import('./i18n/i18n');
    const App = (await import('./App')).default;

    render(<App />);

    // Testing Library's name lookup is the check that a name exists at all.
    expect(await screen.findByRole('button', { name: 'Request new background' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New quote' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open notes' })).not.toBeNull();
  });
});
