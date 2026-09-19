import { Component, type ErrorInfo, type ReactNode } from 'react';
import { UI } from './strings';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info: info.componentStack ?? '' });
    console.error('UI error boundary caught:', error, info);
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-screen">
        <div className="error-card">
          <h1>This page hit a snag.</h1>
          <p>
            Please reload, or return to the <a href="/about">About page</a>.
          </p>
          <button
            type="button"
            className="skip-btn"
            style={{ position: 'static', transform: 'none', marginTop: 8 }}
            onClick={() => location.reload()}
          >
            {UI.reload}
          </button>
          <details>
            <summary>{UI.details}</summary>
            <pre>
              {error.message}
              {'\n'}
              {error.stack}
              {info ? `\n\nComponent stack:${info}` : ''}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
