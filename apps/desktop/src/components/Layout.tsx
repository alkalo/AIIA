import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";
import { AgentGenerationProvider } from "../contexts/AgentGenerationContext";
import "./Layout.css";

export function Layout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const isChat =
    location.pathname === "/" || location.pathname.startsWith("/chat");

  const nav = [
    { path: "/", label: t("nav.chat"), exact: true },
    { path: "/agents", label: t("nav.agents") },
    { path: "/create", label: t("nav.create") },
    { path: "/inbox", label: t("nav.inbox") },
    { path: "/runs", label: t("nav.runs") },
    { path: "/settings", label: t("nav.settings") },
  ];

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === "/" || location.pathname.startsWith("/chat");
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  return (
    <div className={`layout ${isChat ? "layout-chat" : ""}`}>
      {!isChat && (
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
                className={isActive(item.path, item.exact) ? "active" : ""}
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
      )}
      <main className={`content ${isChat ? "content-chat" : ""}`}>
        <AgentGenerationProvider>
          <Outlet />
        </AgentGenerationProvider>
      </main>
    </div>
  );
}
