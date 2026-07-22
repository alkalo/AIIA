import { useEffect, useState, useCallback } from "react";
import { api } from "../api";

export function useAgents() {
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof api.listAgents>>>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const data = await api.listAgents();
      setAgents(data);
    } catch {
      setAgents([]);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, refresh };
}

export function useRunProgress(agentId: string | null, enabled = true) {
  const [progress, setProgress] = useState<{
    phase: string;
    percent: number;
    message: string;
    runId?: string;
    thinkingStep?: string;
    budgetUsedSec?: number;
  } | null>(null);

  useEffect(() => {
    if (!agentId) {
      setProgress(null);
      return;
    }
    if (!enabled) return;

    let cancelled = false;
    let terminal = false;

    const poll = async () => {
      if (cancelled || terminal) return;
      try {
        const p = await api.getRunProgress(agentId);
        if (cancelled || !p) return;
        setProgress({
          phase: p.phase,
          percent: Math.round(p.percent),
          message: p.message,
          runId: p.runId,
          thinkingStep: p.thinkingStep,
          budgetUsedSec: p.budgetUsedSec,
        });
        if (p.phase === "done" || p.phase === "error" || p.phase === "cancelled") terminal = true;
      } catch {
        /* ignore transient read errors */
      }
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agentId, enabled]);

  const isFinished =
    progress?.phase === "done" || progress?.phase === "error" || progress?.phase === "cancelled";

  return { progress, isFinished };
}
