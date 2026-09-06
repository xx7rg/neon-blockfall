import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="notfound-screen">
      <AlertCircle size={56} className="notfound-icon" aria-hidden="true" />
      <h1>404</h1>
      <h2>Rota não encontrada</h2>
      <p>Essa tela não existe ou foi movida. Volte para a arena para continuar jogando.</p>
      <button type="button" className="action-button primary" onClick={() => setLocation("/")}>
        <Home size={16} /> VOLTAR PARA A ARENA
      </button>
    </div>
  );
}
