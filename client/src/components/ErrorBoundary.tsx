import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="errorboundary-screen">
        <AlertTriangle size={48} className="errorboundary-icon" aria-hidden="true" />
        <h2>System failure / Falha no sistema</h2>
        <p>An unexpected error occurred. Reload the page to reconnect.</p>
        <button type="button" className="action-button primary" onClick={() => window.location.reload()}>
          <RotateCcw size={16} /> RELOAD
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
