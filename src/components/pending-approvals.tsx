"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  ShieldX,
  Pencil,
  Loader2,
  ChevronDown,
  ChevronRight,
  Clock,
  Bot,
} from "lucide-react";

interface Gate {
  id: string;
  run_id: string;
  gate_type: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  payload: {
    toolName?: string;
    input?: Record<string, unknown>;
    reasoning?: string;
    targetName?: string;
  };
}

interface Props {
  refreshKey?: number;
  onApproval?: () => void;
}

export function PendingApprovals({ refreshKey, onApproval }: Props) {
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedGate, setExpandedGate] = useState<string | null>(null);
  const [processingGate, setProcessingGate] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState<string>("");

  const fetchGates = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/gates");
      if (res.ok) {
        const data = await res.json();
        setGates(data.gates || []);
      }
    } catch { /* empty */ }
  }, []);

  useEffect(() => {
    fetchGates();
    // Poll every 30 seconds
    const interval = setInterval(fetchGates, 30000);
    return () => clearInterval(interval);
  }, [fetchGates, refreshKey]);

  async function handleAction(gateId: string, action: "approved" | "rejected" | "edited") {
    setProcessingGate(gateId);
    try {
      const body: Record<string, unknown> = { gateId, action };
      if (action === "edited" && editingBody) {
        const gate = gates.find((g) => g.id === gateId);
        const originalInput = gate?.payload?.input || {};
        body.edits = { ...originalInput, body: editingBody };
      }

      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setGates((prev) => prev.filter((g) => g.id !== gateId));
        setExpandedGate(null);
        setEditingBody("");
        onApproval?.();
      }
    } catch { /* empty */ } finally {
      setProcessingGate(null);
    }
  }

  if (gates.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-warning/20">
        <Bot size={14} className="text-warning" />
        <span className="text-xs font-semibold text-warning uppercase tracking-wider">
          Agent Approvals ({gates.length})
        </span>
      </div>

      <div className="divide-y divide-warning/10">
        {gates.map((gate) => {
          const isExpanded = expandedGate === gate.id;
          const isProcessing = processingGate === gate.id;
          const expiresIn = gate.expires_at
            ? Math.max(0, Math.floor((new Date(gate.expires_at).getTime() - Date.now()) / (1000 * 60 * 60)))
            : null;

          return (
            <div key={gate.id} className="px-3 py-2">
              <button
                onClick={() => setExpandedGate(isExpanded ? null : gate.id)}
                className="w-full flex items-center gap-2 text-left"
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="text-xs font-medium flex-1">
                  {gate.payload.toolName === "create_gmail_draft" ? "Create Draft" : "Send Email"}
                  {gate.payload.targetName && ` for ${gate.payload.targetName}`}
                </span>
                {expiresIn !== null && (
                  <span className="text-[10px] text-muted flex items-center gap-1">
                    <Clock size={10} /> {expiresIn}h left
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="mt-2 space-y-2">
                  {gate.payload.reasoning && (
                    <p className="text-[11px] text-muted italic">
                      {gate.payload.reasoning}
                    </p>
                  )}

                  {gate.payload.input && (
                    <div className="bg-background/50 rounded p-2 text-[11px] font-mono">
                      {Object.entries(gate.payload.input).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-muted">{k}:</span>{" "}
                          <span className="text-foreground">{String(v).slice(0, 200)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea
                    className="w-full text-[11px] p-2 rounded border border-border bg-background min-h-[60px] resize-y"
                    placeholder="Edit the message body here (optional)..."
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                  />

                  <div className="flex gap-2">
                    <button
                      disabled={isProcessing}
                      onClick={() => handleAction(gate.id, "approved")}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-success/10 text-success hover:bg-success/20 disabled:opacity-50"
                    >
                      {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                      Approve
                    </button>
                    {editingBody && (
                      <button
                        disabled={isProcessing}
                        onClick={() => handleAction(gate.id, "edited")}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        <Pencil size={12} /> Approve with Edits
                      </button>
                    )}
                    <button
                      disabled={isProcessing}
                      onClick={() => handleAction(gate.id, "rejected")}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-error/10 text-error hover:bg-error/20 disabled:opacity-50"
                    >
                      <ShieldX size={12} /> Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
