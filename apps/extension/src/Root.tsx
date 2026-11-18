import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RecoveryScreen } from './components/RecoveryScreen';

/**
 * The outer of the two boundary levels. Each widget in `App` has its own, so
 * this one only catches what `App` itself or its hooks throw, where there is no
 * smaller piece to drop and the user needs a way out instead of a blank page.
 */
export const Root = () => (
  <ErrorBoundary name='App' fallback={<RecoveryScreen />}>
    <App />
  </ErrorBoundary>
);
