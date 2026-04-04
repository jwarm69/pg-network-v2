"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Send,
  ChevronRight,
  Clock,
  MessageCircle,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Zap,
} from "lucide-react";
import { TargetThread } from "@/components/target-thread";
import type {
  Lane,
  OutreachThread,
  Message,
  Target,
} from "@/lib/db";

interface Props {
  collapsed: boolean;
  onExpand: () => void;
}

// ─── Types for fetched data ───

interface ThreadWithData extends OutreachThread {
  messages: Message[];
  targets: Pick<Target, "id" | "name" | "type" | "status" | "priority" | "score"> | null;
}

interface SelectedTarget {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  score: number | null;
}

export function OutreachPanel({ collapsed, onExpand }: Props) {
  const [threads, setThreads] = useState<ThreadWithData[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch threads on mount
  useEffect(() => {
    fetchThreads();
  }, []);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/outreach");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setThreads(data);
        }
      }
    } catch {
      // Silently handle — threads will be empty
    } finally {
      setLoading(false);
    }
  }, []);

  // Calculate action card counts
  const overdueCount = threads.filter((t) => {
    if (t.status === "active" || t.status === "approved") {
      const lastSent = t.messages
        .filter((m) => m.sent && m.sent_at)
        .sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""))
        [0];
      if (lastSent?.sent_at) {
        const daysSince =
          (Date.now() - new Date(lastSent.sent_at).getTime()) /
          (1000 * 60 * 60 * 24);
        const nextUnsent = t.messages.find((m) => !m.sent);
        return nextUnsent && daysSince > 3;
      }
    }
    return false;
  }).length;

  const responseCount = threads.filter((t) =>
    t.messages.some((m) => m.response_text)
  ).length;

  const draftCount = threads.filter((t) => t.status === "draft").length;

  // Group threads by target
  const threadsByTarget = threads.reduce<
    Record<string, { target: SelectedTarget; threads: ThreadWithData[] }>
  >((acc, thread) => {
    const targetId = thread.target_id;
    if (!acc[targetId]) {
      const t = thread.targets;
      acc[targetId] = {
        target: {
          id: targetId,
          name: t?.name || "Unknown",
          type: t?.type || "celebrity",
          status: t?.status || "new",
          priority: t?.priority || "medium",
          score: t?.score ?? null,
        },
        threads: [],
      };
    }
    acc[targetId].threads.push(thread);
    return acc;
  }, {});

  // Handle generate outreach
  const handleGenerate = useCallback(
    async (targetId: string) => {
      setGenerating(true);
      setError(null);
      try {
        const res = await fetch("/api/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to generate outreach");
        } else {
          // Refresh threads
          await fetchThreads();
        }
      } catch {
        setError("Network error generating outreach");
      } finally {
        setGenerating(false);
      }
    },
    [fetchThreads]
  );

  // Handle message update
  const handleUpdateMessage = useCallback(
    async (messageId: string, updates: Partial<Message>) => {
      try {
        const res = await fetch("/api/outreach", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, ...updates }),
        });
        if (res.ok) {
          // Update local state
          setThreads((prev) =>
            prev.map((t) => ({
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId ? { ...m, ...updates } : m
              ),
            }))
          );
        }
      } catch {
        // Silent fail
      }
    },
    []
  );

  // Handle thread update
  const handleUpdateThread = useCallback(
    async (threadId: string, updates: Partial<OutreachThread>) => {
      try {
        const res = await fetch("/api/outreach", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, ...updates }),
        });
        if (res.ok) {
          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId ? { ...t, ...updates } : t
            )
          );
        }
      } catch {
        // Silent fail
      }
    },
    []
  );

  // ─── Collapsed state ───

  if (collapsed) {
    return (
      <button
        onClick={onExpand}
        className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted hover:text-secondary transition-colors p-2"
      >
        <Send size={20} />
        <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-lr]">
          Outreach
        </span>
      </button>
    );
  }

  // ─── Expanded target detail view ───

  if (selectedTarget) {
    const targetThreads = threadsByTarget[selectedTarget.id]?.threads || [];

    return (
      <div className="h-full flex flex-col">
        <div className="p-4 pb-0">
          <button
            onClick={() => setSelectedTarget(null)}
            className="flex items-center gap-1 text-xs text-muted hover:text-secondary mb-2"
          >
            <ArrowLeft size={12} /> Back to threads
          </button>
        </div>
        <TargetThread
          target={selectedTarget}
          threads={targetThreads}
          research={[]}
          onClose={() => setSelectedTarget(null)}
          onUpdateMessage={handleUpdateMessage}
          onUpdateThread={handleUpdateThread}
        />
      </div>
    );
  }

  // ─── Main panel view ───

  return (
    <div className="p-4 h-full flex flex-col" onClick={onExpand}>
      {/* Panel header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider">
            Outreach + Follow-ups
          </h2>
        </div>
        <button className="text-xs text-muted hover:text-secondary flex items-center gap-1">
          View all <ChevronRight size={12} />
        </button>
      </div>

      {/* Action required section */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          Action Required
        </h3>
        <div className="space-y-2">
          <ActionCard
            icon={<AlertCircle size={14} className="text-danger" />}
            label="Overdue follow-ups"
            count={overdueCount}
            color="danger"
          />
          <ActionCard
            icon={<MessageCircle size={14} className="text-success" />}
            label="New responses"
            count={responseCount}
            color="success"
          />
          <ActionCard
            icon={<Clock size={14} className="text-warning" />}
            label="Drafts to review"
            count={draftCount}
            color="warning"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 p-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">
          {error}
        </div>
      )}

      {/* Active threads */}
      <div className="flex-1 overflow-y-auto">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          Active Threads
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        ) : Object.keys(threadsByTarget).length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">
            <Send size={24} className="mx-auto mb-2 opacity-50" />
            <p>No active outreach</p>
            <p className="text-xs mt-1">
              Research a target, then generate 3-lane outreach
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {Object.entries(threadsByTarget).map(
              ([targetId, { target, threads: targetThreads }]) => {
                // Find the most relevant thread to show
                const activeThread =
                  targetThreads.find((t) => t.status === "active") ||
                  targetThreads.find((t) => t.status === "approved") ||
                  targetThreads[0];

                const currentMsg = activeThread?.messages.find(
                  (m) => !m.sent
                );
                const stage = currentMsg
                  ? `M${currentMsg.sequence}`
                  : "Done";

                // Urgency color
                const hasOverdue = targetThreads.some((t) => {
                  const lastSent = t.messages
                    .filter((m) => m.sent && m.sent_at)
                    .sort(
                      (a, b) =>
                        (b.sent_at || "").localeCompare(a.sent_at || "")
                    )[0];
                  if (lastSent?.sent_at) {
                    const days =
                      (Date.now() -
                        new Date(lastSent.sent_at).getTime()) /
                      (1000 * 60 * 60 * 24);
                    return days > 3;
                  }
                  return false;
                });

                const hasResponse = targetThreads.some((t) =>
                  t.messages.some((m) => m.response_text)
                );

                return (
                  <button
                    key={targetId}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTarget(target);
                    }}
                    className="w-full text-left p-3 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-foreground truncate">
                        {target.name}
                      </span>
                      <div className="flex items-center gap-1">
                        {hasOverdue && (
                          <span className="w-2 h-2 rounded-full bg-danger" />
                        )}
                        {hasResponse && (
                          <span className="w-2 h-2 rounded-full bg-success" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted">
                      {/* Lane indicators */}
                      {targetThreads.map((t) => (
                        <span
                          key={t.id}
                          className={`w-1.5 h-1.5 rounded-full ${
                            t.lane === "direct"
                              ? "bg-primary"
                              : t.lane === "agent"
                                ? "bg-info"
                                : "bg-warning"
                          }`}
                        />
                      ))}
                      <span>
                        {activeThread?.lane || "\u2014"} / {stage}
                      </span>
                      <span className="ml-auto">
                        {activeThread?.status || "\u2014"}
                      </span>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        )}
      </div>

      {/* Generate button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          // For now, try generating for the first target we can find
          const firstTarget = Object.values(threadsByTarget)[0]?.target;
          if (firstTarget) {
            handleGenerate(firstTarget.id);
          }
        }}
        disabled={generating}
        className="mt-3 w-full py-2.5 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-hover transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
      >
        {generating ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Generating...
          </>
        ) : (
          <>
            <Zap size={14} /> Generate Outreach
          </>
        )}
      </button>

      {/* Legend */}
      <div className="flex gap-4 pt-2 mt-2 border-t border-border text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-primary" /> Direct
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-info" /> Agent
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-warning" /> Wild Card
        </span>
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
}) {
  const bgColors: Record<string, string> = {
    danger: "bg-danger/5 border-danger/10",
    success: "bg-success/5 border-success/10",
    warning: "bg-warning/5 border-warning/10",
  };

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border ${bgColors[color] || "bg-card border-border"}`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-sm font-bold">{count}</span>
    </div>
  );
}
