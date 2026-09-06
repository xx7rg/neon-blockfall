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
        <h2>Algo deu errado</h2>
        <p>Ocorreu um erro inesperado. Recarregue a página para voltar ao jogo.</p>
        <button type="button" className="action-button primary" onClick={() => window.location.reload()}>
          <RotateCcw size={16} /> RECARREGAR
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
