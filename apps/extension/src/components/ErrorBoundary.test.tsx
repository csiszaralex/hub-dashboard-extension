import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

const silenceExpectedErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

// Hoisted out of the JSX: `i18next/no-literal-string` flags literals inside it.
const RECOVERED = 'recovered';
const RETRY = 'retry';

describe('ErrorBoundary', () => {
  it('renders nothing in place of a throwing child by default, and reports it once', () => {
    silenceExpectedErrors();
    const onError = vi.fn();
    const Broken = () => {
      throw new Error('broken');
    };

    const { container } = render(
      <ErrorBoundary name='Broken' onError={onError}>
        <Broken />
      </ErrorBoundary>,
    );

    expect(container.innerHTML).toBe('');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('hands a render-function fallback a reset that tries the children again', () => {
    silenceExpectedErrors();
    let fail = true;
    const Flaky = () => {
      if (fail) throw new Error('flaky');
      return <p>{RECOVERED}</p>;
    };

    render(
      <ErrorBoundary
        name='Flaky'
        fallback={(reset) => (
          <button type='button' onClick={reset}>
            {RETRY}
          </button>
        )}
      >
        <Flaky />
      </ErrorBoundary>,
    );

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: RETRY }));

    expect(screen.getByText(RECOVERED)).not.toBeNull();
  });
});
