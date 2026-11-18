import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmUp } from './test/warmUp';

warmUp(() => Promise.all([import('./i18n/i18n'), import('./Root')]));

const QUOTE = { text: 'Be one.', author: 'Marcus Aurelius' };

const serveQuote = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/quote')) return new Response(JSON.stringify(QUOTE));
      return Promise.reject(new TypeError('Failed to fetch'));
    }),
  );

const throwing = (message: string) => () => {
  throw new Error(message);
};

/** The boundary logs what it caught; that is the expected output here, not noise to fix. */
const silenceExpectedErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

const GREETING = /Good (night|morning|day|evening)/;

const renderRoot = async () => {
  await import('./i18n/i18n');
  const { Root } = await import('./Root');
  return render(<Root />);
};

// `vi.resetModules()` in `setup.ts` clears evaluated modules, not the mock
// registry, so a mock left in place would leak into the next test.
afterEach(() => {
  vi.doUnmock('./components/WeatherWidget');
  vi.doUnmock('./components/Clock');
  vi.doUnmock('./App');
  vi.doUnmock('./utils/recovery');
});

describe('Root — per-widget boundaries', () => {
  beforeEach(serveQuote);

  it('keeps the clock and the quote when another widget throws', async () => {
    const error = silenceExpectedErrors();
    vi.doMock('./components/WeatherWidget', () => ({
      WeatherWidget: throwing('unexpected cached shape'),
    }));

    await renderRoot();

    await waitFor(() => expect(screen.getByText(/Be one\./)).not.toBeNull());
    expect(screen.getByText(GREETING)).not.toBeNull();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(error).toHaveBeenCalledWith(
      'WeatherWidget failed to render:',
      expect.any(Error),
      expect.anything(),
    );
  });

  it('keeps the quote when the clock itself throws', async () => {
    silenceExpectedErrors();
    vi.doMock('./components/Clock', () => ({ Clock: throwing('clock broke') }));

    await renderRoot();

    await waitFor(() => expect(screen.getByText(/Be one\./)).not.toBeNull());
    expect(screen.queryByText(GREETING)).toBeNull();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});

describe('Root — recovery screen', () => {
  const clearRecoverableData = vi.fn(async () => {});

  beforeEach(() => {
    clearRecoverableData.mockClear();
    vi.doMock('./App', () => ({ default: throwing('App broke') }));
    vi.doMock('./utils/recovery', () => ({ clearRecoverableData }));
  });

  it('replaces a throwing App with a way out', async () => {
    silenceExpectedErrors();

    await renderRoot();

    expect(screen.getByText('Something went wrong')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Clear cached data and reload' })).not.toBeNull();
  });

  it('reloads from the Reload button without clearing anything', async () => {
    silenceExpectedErrors();
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});

    await renderRoot();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(clearRecoverableData).not.toHaveBeenCalled();
  });

  it('clears the caches, then reloads', async () => {
    silenceExpectedErrors();
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});

    await renderRoot();
    fireEvent.click(screen.getByRole('button', { name: 'Clear cached data and reload' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(clearRecoverableData).toHaveBeenCalledTimes(1);
  });

  it('still renders when translation lookup throws', async () => {
    // A fallback that threw would hand back the blank page it exists to replace.
    silenceExpectedErrors();
    const i18n = (await import('./i18n/i18n')).default;
    vi.spyOn(i18n, 't').mockImplementation(() => {
      throw new Error('i18n broke');
    });

    await renderRoot();

    expect(screen.getByText('Something went wrong')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeNull();
  });
});
