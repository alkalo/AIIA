import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";
import { AgentGenerationProvider } from "../contexts/AgentGenerationContext";
import "./Layout.css";

export function Layout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();

  const nav = [
    { path: "/", label: t("nav.dashboard") },
    { path: "/create", label: t("nav.create") },
    { path: "/inbox", label: t("nav.inbox") },
    { path: "/runs", label: t("nav.runs") },
    { path: "/settings", label: t("nav.settings") },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <h1>{t("app.name")}</h1>
          <p>{t("app.tagline")}</p>
        </div>
        <nav>
          {nav.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={location.pathname === item.path ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="lang-switch">
          <button
            type="button"
            className={i18n.language === "es" ? "active" : ""}
            onClick={() => {
              i18n.changeLanguage("es");
              localStorage.setItem("aiia-lang", "es");
            }}
          >
            ES
          </button>
          <button
            type="button"
            className={i18n.language === "en" ? "active" : ""}
            onClick={() => {
              i18n.changeLanguage("en");
              localStorage.setItem("aiia-lang", "en");
            }}
          >
            EN
          </button>
        </div>
      </aside>
      <main className="content">
        <AgentGenerationProvider>
          <Outlet />
        </AgentGenerationProvider>
      </main>
    </div>
  );
}
