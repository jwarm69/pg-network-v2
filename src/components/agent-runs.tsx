"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bot,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
} from "lucide-react";

interface AgentRun {
  id: string;
  goal: string;
  target_id: string | null;
  status: string;
  trigger: string;
  tokens_used: number;
  result_json: string | null;
  created_at: string;
  completed_at: string | null;
}

interface RunEvaluation {
  overallScore: number;
  goalAchieved: boolean;
  dataQuality: number;
  decisionQuality: number;
  completeness: number;
  issues: string[];
  summary: string;
}

interface AgentStep {
  id: string;
  step_index: number;
  type: string;
  reasoning: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface Props {
  className?: string;
}

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  completed: CheckCircle,
  failed: XCircle,
  cancelled: XCircle,
  executing: Loader2,
  awaiting_approval: Clock,
  pending: Clock,
  planning: Loader2,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "text-success",
  failed: "text-error",
  cancelled: "text-muted",
  executing: "text-primary",
  awaiting_approval: "text-warning",
  pending: "text-muted",
  planning: "text-primary",
};

export function AgentRuns({ className }: Props) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [newGoal, setNewGoal] = useState("");
  const [starting, setStarting] = useState(false);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/status?limit=20");
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch { /* empty */ }
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 15000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  async function loadSteps(runId: string) {
    setLoadingSteps(true);
    try {
      const res = await fetch(`/api/agent/status?runId=${runId}`);
      if (res.ok) {
        const data = await res.json();
        setSteps(data.steps || []);
      }
    } catch { /* empty */ } finally {
      setLoadingSteps(false);
    }
  }

  async function startRun() {
    if (!newGoal.trim()) return;
    setStarting(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: newGoal.trim() }),
      });
      if (res.ok) {
        setNewGoal("");
        fetchRuns();
      }
    } catch { /* empty */ } finally {
      setStarting(false);
    }
  }

  function toggleRun(runId: string) {
    if (expandedRun === runId) {
      setExpandedRun(null);
      setSteps([]);
    } else {
      setExpandedRun(runId);
      loadSteps(runId);
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${className || ""}`}>
      {/* Start new run */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && startRun()}
          placeholder="Agent goal: e.g. 'Research and draft outreach for Tiger Woods'"
          className="flex-1 text-xs px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:border-primary"
        />
        <button
          onClick={startRun}
          disabled={starting || !newGoal.trim()}
          className="flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Run
        </button>
      </div>

      {/* Run list */}
      {runs.length === 0 ? (
        <div className="text-xs text-muted text-center py-4">
          No agent runs yet. Start one above.
        </div>
      ) : (
        <div className="space-y-1">
          {runs.map((run) => {
            const StatusIcon = STATUS_ICONS[run.status] || Clock;
            const color = STATUS_COLORS[run.status] || "text-muted";
            const isExpanded = expandedRun === run.id;
            const isAnimated = ["executing", "planning"].includes(run.status);

            return (
              <div key={run.id} className="rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => toggleRun(run.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-card/50 transition-colors"
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <StatusIcon size={14} className={`${color} ${isAnimated ? "animate-spin" : ""}`} />
                  <span className="text-xs flex-1 truncate">{run.goal}</span>
                  <span className="text-[10px] text-muted">
                    {new Date(run.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-2 border-t border-border/50">
                    {loadingSteps ? (
                      <div className="py-2 text-xs text-muted flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> Loading steps...
                      </div>
                    ) : steps.length === 0 ? (
                      <div className="py-2 text-xs text-muted">No steps recorded yet.</div>
                    ) : (
                      <div className="py-2 space-y-1">
                        {steps.map((step) => (
                          <div key={step.id} className="flex items-start gap-2 text-[11px]">
                            <span className="text-muted font-mono w-4 shrink-0">{step.step_index}</span>
                            <span className={`font-semibold uppercase text-[10px] w-16 shrink-0 ${
                              step.type === "error" ? "text-error" :
                              step.type === "gate_check" ? "text-warning" :
                              step.type === "observe" ? "text-success" :
                              "text-primary"
                            }`}>
                              {step.type}
                            </span>
                            <span className="text-foreground/80 flex-1">
                              {step.reasoning?.slice(0, 200) || "—"}
                            </span>
                            {step.duration_ms && (
                              <span className="text-muted text-[10px]">{step.duration_ms}ms</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Evaluation display */}
                    {run.result_json && (() => {
                      try {
                        const result = JSON.parse(run.result_json);
                        const eval_ = result.evaluation as RunEvaluation | undefined;
                        if (!eval_) return null;
                        return (
                          <div className="py-1.5 border-t border-border/30 space-y-1">
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="font-semibold text-secondary">Evaluation:</span>
                              <span className={`font-bold ${eval_.overallScore >= 70 ? "text-success" : eval_.overallScore >= 40 ? "text-warning" : "text-error"}`}>
                                {eval_.overallScore}/100
                              </span>
                              <span className={eval_.goalAchieved ? "text-success" : "text-error"}>
                                {eval_.goalAchieved ? "Goal achieved" : "Goal not achieved"}
                              </span>
                            </div>
                            <div className="flex gap-3 text-[9px] text-muted">
                              <span>Data: {eval_.dataQuality}</span>
                              <span>Decisions: {eval_.decisionQuality}</span>
                              <span>Completeness: {eval_.completeness}</span>
                            </div>
                            {eval_.issues && eval_.issues.length > 0 && (
                              <div className="text-[9px] text-error/80">
                                Issues: {eval_.issues.join("; ")}
                              </div>
                            )}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    <div className="flex items-center gap-3 text-[10px] text-muted pt-1 border-t border-border/30">
                      <span>Status: {run.status}</span>
                      <span>Tokens: {run.tokens_used}</span>
                      <span>Trigger: {run.trigger}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
