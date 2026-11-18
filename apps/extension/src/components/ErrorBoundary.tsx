import { Component, type ErrorInfo, type ReactNode } from 'react';

type Fallback = ReactNode | ((reset: () => void) => ReactNode);

interface ErrorBoundaryProps {
  /** Names the subtree in the console, so a report says which widget failed. */
  name: string;
  /** What renders instead of a subtree that threw. Nothing, by default. */
  fallback?: Fallback;
  /** Called once per failure, after it has been logged. */
  onError?: (error: unknown) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Keeps one throwing subtree from unmounting the whole page.
 *
 * Without it React drops the entire tree on a render error, and because the
 * cause is usually a cached value, every new tab comes up blank until the user
 * clears extension data by hand. A class component because React still offers
 * `getDerivedStateFromError` and `componentDidCatch` to nothing else.
 *
 * Renders no element of its own, so wrapping a widget leaves the layout alone.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`${this.props.name} failed to render:`, error, info.componentStack);
    this.props.onError?.(error);
  }

  private reset = () => this.setState({ failed: false });

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { fallback = null } = this.props;
    return typeof fallback === 'function' ? fallback(this.reset) : fallback;
  }
}
