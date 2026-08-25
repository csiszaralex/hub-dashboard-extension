import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QuoteData } from '@hub/shared';

const CITATUM: QuoteData = {
  text: 'Üres fejjel lehet megélni, üres gyomorral nem.',
  author: 'Móra Ferenc',
  sourceUrl: 'https://www.citatum.hu/idezet/5073',
};

const PLAIN: QuoteData = { text: 'Be one.', author: 'Marcus Aurelius' };

const renderWith = async (quote: QuoteData) => {
  vi.doMock('../hooks/useQuote', () => ({ useQuote: () => quote }));
  await import('../i18n/i18n');
  const { QuoteWidget } = await import('./QuoteWidget');
  return render(<QuoteWidget />);
};

describe('QuoteWidget attribution', () => {
  it('links back to the quote when the source requires credit', async () => {
    // Citatum's terms make this a condition of using their API, not a nicety:
    // their quotes may only be shown with a visible link back.
    await renderWith(CITATUM);

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://www.citatum.hu/idezet/5073');
  });

  it('shows no link for a source that sends none', async () => {
    // A built-in list credits its author in the text and has nowhere to point;
    // an empty link would be worse than none.
    await renderWith(PLAIN);

    // Queried by its visible label, not by role: an anchor React renders with
    // no `href` has no `link` role at all, so `queryByRole('link')` reports
    // nothing whether the element is absent or merely pointing nowhere. That
    // distinction is the whole assertion.
    expect(screen.queryByText('Source')).toBeNull();
    expect(screen.getByText(/Marcus Aurelius/)).not.toBeNull();
  });
});
