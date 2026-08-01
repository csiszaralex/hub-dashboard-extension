import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const load = async () => (await import('./useUiVisibility')).useUiVisibility;

const press = (key: string, options: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });

describe('useUiVisibility', () => {
  it('starts visible', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    expect(result.current.uiVisible).toBe(true);
  });

  it('hides on the period shortcut', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    press('.');

    expect(result.current.uiVisible).toBe(false);
  });

  it('shows again on a second press', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    press('.');
    press('.');

    expect(result.current.uiVisible).toBe(true);
  });

  it('brings the UI back on Escape but never hides it', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());
    press('.');

    press('Escape');
    expect(result.current.uiVisible).toBe(true);

    press('Escape');
    expect(result.current.uiVisible).toBe(true);
  });

  it('ignores the shortcut while a text field has focus', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    press('.');
    input.remove();

    expect(result.current.uiVisible).toBe(true);
  });

  it('ignores the shortcut when a modifier is held, so browser shortcuts still work', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());

    press('.', { ctrlKey: true });

    expect(result.current.uiVisible).toBe(true);
  });

  it('ignores Escape when a modifier is held, so system shortcuts like Ctrl+Esc still work', async () => {
    const useUiVisibility = await load();
    const { result } = renderHook(() => useUiVisibility());
    press('.'); // hide first — a modifier-held Escape must not be the thing that restores it

    press('Escape', { ctrlKey: true });

    expect(result.current.uiVisible).toBe(false);
  });

  it('removes its keydown listener from window on unmount', async () => {
    const useUiVisibility = await load();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useUiVisibility());

    const [, handler] = addSpy.mock.calls.find(([type]) => type === 'keydown')!;
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', handler);
  });
});
