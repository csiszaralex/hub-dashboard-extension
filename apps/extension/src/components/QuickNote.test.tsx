import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  // Installs the react-i18next binding, or every name below is a raw key.
  await import('../i18n/i18n');
  return (await import('./QuickNote')).QuickNote;
};

describe('QuickNote — clearing', () => {
  const NOTE_KEY = 'quick_note_content';

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Opens the note with `text` already saved in it. */
  const renderWithNote = async (text: string) => {
    localStorage.setItem(NOTE_KEY, text);
    const QuickNote = await load();
    render(<QuickNote />);
    fireEvent.click(screen.getByRole('button', { name: 'Open notes' }));
    return screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
  };

  // The delete button takes the whole note in one click. The clear is saved
  // like any edit, and Undo puts the text back and saves that too.
  it('saves the cleared note, and Undo restores and saves the text', async () => {
    const textarea = await renderWithNote('buy oat milk');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(textarea.value).toBe('');
    expect(screen.getByRole('status').textContent).toContain('Note cleared');
    await waitFor(() => expect(localStorage.getItem(NOTE_KEY)).toBe(''));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(textarea.value).toBe('buy oat milk');
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(localStorage.getItem(NOTE_KEY)).toBe('buy oat milk'));
  });

  it('withdraws the undo once its time is up', async () => {
    const { UNDO_WINDOW_MS } = await import('../utils/undo');
    await renderWithNote('buy oat milk');
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));

    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(NOTE_KEY)).toBe('');
  });

  // Restoring the old text over something typed since would lose the newer one.
  it('withdraws the undo once the user types again', async () => {
    const textarea = await renderWithNote('buy oat milk');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.change(textarea, { target: { value: 'call the vet' } });

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('offers no undo for a note that was already empty', async () => {
    await renderWithNote('');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('QuickNote — accessibility', () => {
  it('names its icon-only toggle and says whether the note is open', async () => {
    const QuickNote = await load();

    render(<QuickNote />);

    const open = screen.getByRole('button', { name: 'Open notes' });
    expect(open.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(open);

    const close = screen.getByRole('button', { name: 'Close notes' });
    expect(close.getAttribute('aria-expanded')).toBe('true');
  });

  // The closed panel is only faded out, so without `inert` its textarea and
  // delete button stayed in the Tab order of a panel nobody could see.
  it('keeps the closed panel out of reach and names the textarea', async () => {
    const QuickNote = await load();

    render(<QuickNote />);

    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea.closest('[inert]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open notes' }));

    expect(textarea.closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeNull();
  });
});
