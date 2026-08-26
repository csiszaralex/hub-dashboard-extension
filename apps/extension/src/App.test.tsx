import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub } from './test/chromeStub';

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
