import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'quick_note_content';

const loadHook = async () => (await import('./useNote')).useNote;

describe('useNote', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts from the stored note', async () => {
    localStorage.setItem(KEY, 'buy milk');
    const useNote = await loadHook();
    const { result } = renderHook(() => useNote());
    expect(result.current.note).toBe('buy milk');
  });

  it('writes once typing pauses', async () => {
    const useNote = await loadHook();
    const { result } = renderHook(() => useNote());

    act(() => result.current.setNote('first'));
    act(() => result.current.setNote('first draft'));
    expect(localStorage.getItem(KEY)).toBeNull();

    act(() => vi.advanceTimersByTime(500));
    expect(localStorage.getItem(KEY)).toBe('first draft');
  });

  it('flushes a pending write when the tab is closed', async () => {
    const useNote = await loadHook();
    const { result } = renderHook(() => useNote());

    act(() => result.current.setNote('typed just before closing'));
    window.dispatchEvent(new Event('pagehide'));

    expect(localStorage.getItem(KEY)).toBe('typed just before closing');
  });

  it('flushes a pending write on unmount', async () => {
    const useNote = await loadHook();
    const { result, unmount } = renderHook(() => useNote());

    act(() => result.current.setNote('still typing'));
    unmount();

    expect(localStorage.getItem(KEY)).toBe('still typing');
  });

  it('follows an edit made in another tab', async () => {
    const useNote = await loadHook();
    const { result } = renderHook(() => useNote());

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'from the other tab' }));
    });

    expect(result.current.note).toBe('from the other tab');
  });

  it('keeps its own unsaved typing over another tab’s edit', async () => {
    const useNote = await loadHook();
    const { result } = renderHook(() => useNote());

    act(() => result.current.setNote('mine, not saved yet'));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'theirs' }));
    });

    expect(result.current.note).toBe('mine, not saved yet');
  });

  it('survives a refused write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const useNote = await loadHook();
    const { result } = renderHook(() => useNote());

    act(() => result.current.setNote('too much'));
    expect(() => act(() => vi.advanceTimersByTime(500))).not.toThrow();
    expect(result.current.note).toBe('too much');
  });
});
