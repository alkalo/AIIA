import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { UpdateStatus } from "../api";
import "./UpdateOverlay.css";

const BLOCKING_PHASES = new Set(["checking", "downloading", "verifying", "installing"]);

export function UpdateOverlay() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<UpdateStatus>("update-status", (event) => {
      setStatus(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  if (!status || !BLOCKING_PHASES.has(status.phase)) {
    return null;
  }

  const percent =
    status.phase === "downloading" || status.phase === "verifying"
      ? Math.max(0, Math.min(100, status.percent ?? 0))
      : status.phase === "installing"
        ? 100
        : null;

  const title =
    status.phase === "checking"
      ? t("updateOverlay.checking")
      : status.phase === "verifying"
        ? t("updateOverlay.verifying")
        : status.phase === "installing"
          ? t("updateOverlay.installing")
          : t("updateOverlay.downloading");

  const detail =
    status.version != null
      ? t("updateOverlay.version", { version: status.version })
      : status.message;

  return (
    <div className="update-overlay" role="alertdialog" aria-modal="true" aria-live="assertive">
      <div className="update-overlay-card">
        <p className="update-overlay-title">{title}</p>
        <p className="update-overlay-detail">{detail}</p>
        {percent != null && (
          <div className="update-overlay-bar">
            <div className="update-overlay-bar-fill" style={{ width: `${Math.max(percent, 2)}%` }} />
          </div>
        )}
        {percent != null && status.phase === "downloading" && (
          <p className="update-overlay-pct">{percent}%</p>
        )}
        <p className="update-overlay-hint">{t("updateOverlay.hint")}</p>
      </div>
    </div>
  );
}
