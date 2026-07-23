import { useState, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Chat } from "./pages/Chat";
import { Dashboard } from "./pages/Dashboard";
import { CreateAgent } from "./pages/CreateAgent";
import { ReviewAgent } from "./pages/ReviewAgent";
import { Inbox } from "./pages/Inbox";
import { Runs } from "./pages/Runs";
import { Settings } from "./pages/Settings";
import { Onboarding } from "./pages/Onboarding";
import { api } from "./api";
import { UpdateOverlay } from "./components/UpdateOverlay";
import "./App.css";
import "./i18n";

function App() {
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem("aiia-onboarded") === "1"
  );

  useEffect(() => {
    if (!onboarded) return;
    // Pull Gemini cloud cron results when the app opens (no-op if not configured).
    void api.pullCloudRuns().catch(() => undefined);
  }, [onboarded]);

  const completeOnboarding = () => {
    localStorage.setItem("aiia-onboarded", "1");
    setOnboarded(true);
  };

  if (!onboarded) {
    return (
      <>
        <UpdateOverlay />
        <Onboarding onComplete={completeOnboarding} />
      </>
    );
  }

  return (
    <>
      <UpdateOverlay />
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Chat />} />
            <Route path="/chat/:id" element={<Chat />} />
            <Route path="/agents" element={<Dashboard />} />
            <Route path="/create" element={<CreateAgent />} />
            <Route path="/review/:id" element={<ReviewAgent />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}

export default App;
