"use client";

import { useState, useEffect, useCallback } from "react";
import { AgentRuns } from "./agent-runs";
import { PendingApprovals } from "./pending-approvals";
import {
  Bot,
  Activity,
  FlaskConical,
  Brain,
  TrendingUp,
  RefreshCw,
  Loader2,
} from "lucide-react";

type Tab = "runs" | "learning" | "experiments";

interface LearnedPref {
  id: string;
  category: string;
  key: string;
  value_json: string;
  confidence: number;
  sample_size: number;
  updated_at: string;
}

interface ExperimentData {
  id: string;
  name: string;
  hypothesis: string;
  variable: string;
  status: string;
  metric: string;
  min_samples: number;
  created_at: string;
}

interface Props {
  refreshKey?: number;
  onDataChange?: () => void;
}

export function AgentView({ refreshKey, onDataChange }: Props) {
  const [tab, setTab] = useState<Tab>("runs");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-4 pb-2 border-b border-border">
        <TabButton active={tab === "runs"} onClick={() => setTab("runs")} icon={Bot} label="Runs" />
        <TabButton active={tab === "learning"} onClick={() => setTab("learning")} icon={Brain} label="Learning" />
        <TabButton active={tab === "experiments"} onClick={() => setTab("experiments")} icon={FlaskConical} label="Experiments" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "runs" && <RunsTab refreshKey={refreshKey} onDataChange={onDataChange} />}
        {tab === "learning" && <LearningTab />}
        {tab === "experiments" && <ExperimentsTab />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bot;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted hover:text-secondary hover:bg-card"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

// ─── Runs Tab ───

function RunsTab({ refreshKey, onDataChange }: { refreshKey?: number; onDataChange?: () => void }) {
  return (
    <div className="space-y-4">
      <PendingApprovals refreshKey={refreshKey} onApproval={onDataChange} />
      <AgentRuns />
    </div>
  );
}

// ─── Learning Tab ───

function LearningTab() {
  const [prefs, setPrefs] = useState<LearnedPref[]>([]);
  const [signals, setSignals] = useState<{ total: number; recent: Array<{ signal_type: string; signal_value: string; created_at: string }> }>({ total: 0, recent: [] });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch learned preferences via agent status endpoint
      // We'll use the experiments endpoint as a proxy, or direct fetch
      const [prefsRes, signalsRes] = await Promise.allSettled([
        fetch("/api/agent/learning"),
        fetch("/api/agent/learning?signals=true"),
      ]);

      // These endpoints don't exist yet, so we handle gracefully
      if (prefsRes.status === "fulfilled" && prefsRes.value.ok) {
        const data = await prefsRes.value.json();
        setPrefs(data.preferences || []);
        setSignals(data.signals || { total: 0, recent: [] });
      }
    } catch { /* empty */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted text-xs">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading learning data...
      </div>
    );
  }

  if (prefs.length === 0) {
    return (
      <div className="text-center py-12">
        <Brain size={32} className="mx-auto mb-3 text-muted/30" />
        <p className="text-xs text-muted">No learned preferences yet.</p>
        <p className="text-[11px] text-muted/60 mt-1">
          The system learns from outcomes: approvals, edits, rejections, replies, and meetings.
          Run the agent and interact with its output to build learning data.
        </p>
      </div>
    );
  }

  // Group by category
  const grouped: Record<string, LearnedPref[]> = {};
  for (const p of prefs) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }

  const categoryLabels: Record<string, { label: string; icon: typeof TrendingUp }> = {
    angle_effectiveness: { label: "Angle Effectiveness", icon: TrendingUp },
    edit_patterns: { label: "Edit Patterns", icon: Activity },
    channel_preference: { label: "Channel Preferences", icon: Activity },
    timing: { label: "Timing", icon: Activity },
    scoring_bias: { label: "Scoring Calibration", icon: Activity },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
          <Brain size={13} /> Learned Preferences
        </h3>
        <button onClick={fetchData} className="text-muted hover:text-secondary">
          <RefreshCw size={12} />
        </button>
      </div>

      {Object.entries(grouped).map(([category, items]) => {
        const meta = categoryLabels[category] || { label: category, icon: Activity };
        const CategoryIcon = meta.icon;

        return (
          <div key={category} className="bg-card border border-border rounded-lg p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-secondary flex items-center gap-1.5 mb-2">
              <CategoryIcon size={12} /> {meta.label}
            </h4>
            <div className="space-y-1.5">
              {items.map((pref) => {
                let displayValue = pref.value_json;
                try {
                  const parsed = JSON.parse(pref.value_json);
                  if (typeof parsed === "object") {
                    displayValue = Object.entries(parsed)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ");
                  }
                } catch { /* use raw */ }

                return (
                  <div key={pref.id} className="flex items-start gap-2 text-[11px]">
                    <span className="font-medium text-foreground min-w-[100px]">{pref.key}</span>
                    <span className="text-secondary flex-1">{displayValue}</span>
                    <span className="text-muted shrink-0">
                      n={pref.sample_size} ({Math.round(pref.confidence * 100)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Experiments Tab ───

function ExperimentsTab() {
  const [experiments, setExperiments] = useState<ExperimentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchExperiments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent/experiments");
      if (res.ok) {
        const data = await res.json();
        setExperiments(data.experiments || []);
      }
    } catch { /* empty */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExperiments(); }, [fetchExperiments]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted text-xs">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading experiments...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
          <FlaskConical size={13} /> A/B Experiments
        </h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs text-primary hover:text-primary-hover font-semibold"
        >
          {showCreate ? "Cancel" : "+ New"}
        </button>
      </div>

      {showCreate && <CreateExperimentForm onCreated={() => { setShowCreate(false); fetchExperiments(); }} />}

      {experiments.length === 0 ? (
        <div className="text-center py-12">
          <FlaskConical size={32} className="mx-auto mb-3 text-muted/30" />
          <p className="text-xs text-muted">No experiments yet.</p>
          <p className="text-[11px] text-muted/60 mt-1">
            Create an experiment to A/B test outreach angles, message lengths,
            follow-up timing, or channels.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {experiments.map((exp) => (
            <div key={exp.id} className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold">{exp.name}</span>
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                  exp.status === "active" ? "bg-success/10 text-success" :
                  exp.status === "concluded" ? "bg-muted/10 text-muted" :
                  "bg-warning/10 text-warning"
                }`}>
                  {exp.status}
                </span>
              </div>
              <p className="text-[11px] text-secondary mb-2">{exp.hypothesis}</p>
              <div className="flex gap-3 text-[10px] text-muted">
                <span>Variable: <strong>{exp.variable}</strong></span>
                <span>Metric: <strong>{exp.metric}</strong></span>
                <span>Min samples: <strong>{exp.min_samples}</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Experiment Form ───

function CreateExperimentForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [variable, setVariable] = useState("angle");
  const [metric, setMetric] = useState("reply_rate");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name || !hypothesis) return;
    setCreating(true);
    try {
      const res = await fetch("/api/agent/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          hypothesis,
          variable,
          metric,
          variants: [
            { id: "a", label: "Control", value: "default", weight: 50 },
            { id: "b", label: "Variant B", value: "variant_b", weight: 50 },
          ],
        }),
      });
      if (res.ok) onCreated();
    } catch { /* empty */ } finally {
      setCreating(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Experiment name"
        className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background"
      />
      <input
        type="text"
        value={hypothesis}
        onChange={(e) => setHypothesis(e.target.value)}
        placeholder="Hypothesis: e.g. 'Charity Bridge angle gets more replies than Founder Parallel'"
        className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background"
      />
      <div className="flex gap-2">
        <select
          value={variable}
          onChange={(e) => setVariable(e.target.value)}
          className="text-xs px-2 py-1.5 rounded border border-border bg-background flex-1"
        >
          <option value="angle">Angle</option>
          <option value="message_length">Message Length</option>
          <option value="follow_up_days">Follow-up Timing</option>
          <option value="channel">Channel</option>
          <option value="subject_style">Subject Style</option>
        </select>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          className="text-xs px-2 py-1.5 rounded border border-border bg-background flex-1"
        >
          <option value="reply_rate">Reply Rate</option>
          <option value="approval_rate">Approval Rate</option>
          <option value="meeting_rate">Meeting Rate</option>
          <option value="sentiment_score">Sentiment Score</option>
        </select>
      </div>
      <button
        onClick={handleCreate}
        disabled={creating || !name || !hypothesis}
        className="w-full text-xs font-semibold py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
      >
        {creating ? "Creating..." : "Create Experiment"}
      </button>
    </div>
  );
}
