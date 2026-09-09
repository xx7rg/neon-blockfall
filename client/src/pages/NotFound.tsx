import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";
import { useT } from "@/i18n/context";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const t = useT();

  return (
    <div className="notfound-screen">
      <AlertCircle size={56} className="notfound-icon" aria-hidden="true" />
      <h1>{t("notfound.code")}</h1>
      <h2>{t("notfound.title")}</h2>
      <p>{t("notfound.body")}</p>
      <button type="button" className="action-button primary" onClick={() => setLocation("/")}>
        <Home size={16} /> {t("notfound.home")}
      </button>
    </div>
  );
}
