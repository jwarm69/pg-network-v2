"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Edit3,
  Send,
  AlertTriangle,
  Clock,
  X,
} from "lucide-react";
import type { Lane, Message, OutreachThread, ActivityEntry } from "@/lib/supabase";

// ─── Types ───

interface ThreadWithMessages extends OutreachThread {
  messages: Message[];
}

interface TargetInfo {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  score: number | null;
}

interface ResearchItem {
  field: string;
  value: string;
}

interface ValidationWarning {
  lane: string;
  sequence: number;
  violations: Array<{ rule: string; detail: string }>;
}

interface Props {
  target: TargetInfo;
  threads: ThreadWithMessages[];
  research: ResearchItem[];
  warnings?: ValidationWarning[];
  onClose: () => void;
  onUpdateMessage: (messageId: string, updates: Partial<Message>) => void;
  onUpdateThread: (threadId: string, updates: Partial<OutreachThread>) => void;
}

// ─── Lane config ───

const LANE_CONFIG: Record<Lane, { label: string; color: string; bgColor: string; borderColor: string }> = {
  direct: {
    label: "Direct",
    color: "text-primary",
    bgColor: "bg-primary/10",
    borderColor: "border-primary/30",
  },
  agent: {
    label: "Agent",
    color: "text-info",
    bgColor: "bg-info/10",
    borderColor: "border-info/30",
  },
  wildcard: {
    label: "Wild Card",
    color: "text-warning",
    bgColor: "bg-warning/10",
    borderColor: "border-warning/30",
  },
};

// ─── Component ───

export function TargetThread({
  target,
  threads,
  research,
  warnings = [],
  onClose,
  onUpdateMessage,
  onUpdateThread,
}: Props) {
  const [expandedLanes, setExpandedLanes] = useState<Set<string>>(
    new Set(threads.map((t) => t.lane))
  );
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    fetch(`/api/activity?targetId=${target.id}&limit=20`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setActivity(data);
      })
      .catch(() => {});
  }, [target.id]);

  const toggleLane = useCallback((lane: string) => {
    setExpandedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) {
        next.delete(lane);
      } else {
        next.add(lane);
      }
      return next;
    });
  }, []);

  const handleCopy = useCallback((messageId: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const handleStartEdit = useCallback((messageId: string, currentBody: string) => {
    setEditingMessage(messageId);
    setEditValue(currentBody);
  }, []);

  const handleSaveEdit = useCallback(
    (messageId: string) => {
      onUpdateMessage(messageId, { body: editValue });
      setEditingMessage(null);
      setEditValue("");
    },
    [editValue, onUpdateMessage]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setEditValue("");
  }, []);

  const handleMarkSent = useCallback(
    (messageId: string) => {
      onUpdateMessage(messageId, {
        sent: true,
        sent_at: new Date().toISOString(),
      });
    },
    [onUpdateMessage]
  );

  const handleApproveThread = useCallback(
    (threadId: string) => {
      onUpdateThread(threadId, { status: "approved" });
    },
    [onUpdateThread]
  );

  // Get warnings for a specific message
  const getWarnings = useCallback(
    (lane: string, sequence: number) =>
      warnings.filter((w) => w.lane === lane && w.sequence === sequence),
    [warnings]
  );

  // Find the current stage for a thread (first unsent message)
  const getCurrentStage = useCallback((messages: Message[]) => {
    const firstUnsent = messages.find((m) => !m.sent);
    return firstUnsent ? `M${firstUnsent.sequence}` : "Done";
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h2 className="text-base font-bold">{target.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-secondary bg-card px-2 py-0.5 rounded">
              {target.type}
            </span>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-secondary bg-card px-2 py-0.5 rounded">
              {target.status}
            </span>
            {target.score !== null && (
              <span className="text-[10px] font-bold text-primary">
                Score: {target.score}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-card transition-colors text-muted hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Research summary */}
        {research.length > 0 && (
          <div className="bg-card rounded-lg p-3 border border-border">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Research Summary
            </h3>
            <div className="space-y-1">
              {research.map((r, i) => (
                <div key={i} className="text-xs">
                  <span className="font-semibold text-secondary">{r.field}:</span>{" "}
                  <span className="text-foreground">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Threads by lane */}
        {threads.length === 0 ? (
          <div className="text-center py-12 text-muted text-sm">
            <Send size={24} className="mx-auto mb-2 opacity-50" />
            <p>No outreach threads yet</p>
            <p className="text-xs mt-1">Generate outreach to create message sequences</p>
          </div>
        ) : (
          threads.map((thread) => {
            const config = LANE_CONFIG[thread.lane] || LANE_CONFIG.direct;
            const isExpanded = expandedLanes.has(thread.lane);
            const stage = getCurrentStage(thread.messages);

            return (
              <div
                key={thread.id}
                className={`rounded-lg border ${config.borderColor} overflow-hidden`}
              >
                {/* Lane header */}
                <button
                  onClick={() => toggleLane(thread.lane)}
                  className={`w-full flex items-center justify-between p-3 ${config.bgColor} hover:opacity-90 transition-opacity`}
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown size={14} className={config.color} />
                    ) : (
                      <ChevronRight size={14} className={config.color} />
                    )}
                    <span className={`text-xs font-bold uppercase tracking-wider ${config.color}`}>
                      {config.label} Lane
                    </span>
                    <span className="text-[10px] text-secondary">
                      ({thread.channel})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted">Stage: {stage}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                        thread.status === "approved"
                          ? "bg-success/20 text-success"
                          : thread.status === "active"
                            ? "bg-info/20 text-info"
                            : "bg-card text-secondary"
                      }`}
                    >
                      {thread.status}
                    </span>
                  </div>
                </button>

                {/* Messages */}
                {isExpanded && (
                  <div className="p-3 space-y-3">
                    {/* Angle */}
                    <div className="text-[10px] text-muted flex items-center gap-1">
                      <span className="font-semibold">Angle:</span>
                      <span className="text-secondary">
                        {warnings.find((w) => w.lane === thread.lane)
                          ? "See warnings"
                          : "Applied"}
                      </span>
                    </div>

                    {thread.messages.map((msg) => {
                      const msgWarnings = getWarnings(thread.lane, msg.sequence);
                      const isEditing = editingMessage === msg.id;
                      const isCopied = copiedId === msg.id;

                      return (
                        <div
                          key={msg.id}
                          className={`rounded-lg border p-3 ${
                            msg.sent
                              ? "border-success/20 bg-success/5"
                              : "border-border bg-card"
                          }`}
                        >
                          {/* Message header */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-bold uppercase ${config.color}`}
                              >
                                M{msg.sequence}
                              </span>
                              {msg.subject && (
                                <span className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                                  {msg.subject}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {msg.sent && (
                                <span className="text-[10px] text-success flex items-center gap-0.5">
                                  <Check size={10} /> Sent
                                </span>
                              )}
                              {msg.response_text && (
                                <span className="text-[10px] text-info flex items-center gap-0.5">
                                  Replied
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Message body */}
                          {isEditing ? (
                            <div className="space-y-2">
                              <textarea
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="w-full bg-input border border-border rounded-lg p-2 text-xs text-foreground resize-none outline-none focus:border-primary"
                                rows={6}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSaveEdit(msg.id)}
                                  className="text-[10px] px-2 py-1 bg-primary text-white rounded font-semibold hover:bg-primary-hover"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="text-[10px] px-2 py-1 bg-card text-muted rounded font-semibold hover:text-foreground border border-border"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-secondary whitespace-pre-wrap leading-relaxed">
                              {msg.body}
                            </p>
                          )}

                          {/* Validation warnings */}
                          {msgWarnings.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {msgWarnings.map((w, wi) =>
                                w.violations.map((v, vi) => (
                                  <div
                                    key={`${wi}-${vi}`}
                                    className="flex items-start gap-1 text-[10px] text-warning bg-warning/10 rounded px-2 py-1"
                                  >
                                    <AlertTriangle
                                      size={10}
                                      className="shrink-0 mt-0.5"
                                    />
                                    <span>{v.detail}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          )}

                          {/* Response */}
                          {msg.response_text && (
                            <div className="mt-2 p-2 bg-info/10 rounded-lg border border-info/20">
                              <div className="text-[10px] text-info font-semibold mb-1">
                                Response{" "}
                                {msg.response_sentiment && (
                                  <span className="text-muted font-normal">
                                    ({msg.response_sentiment})
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-secondary">
                                {msg.response_text}
                              </p>
                            </div>
                          )}

                          {/* Actions */}
                          {!isEditing && (
                            <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border">
                              <button
                                onClick={() =>
                                  handleStartEdit(msg.id, msg.body)
                                }
                                className="text-[10px] px-2 py-1 text-muted hover:text-foreground hover:bg-input rounded transition-colors flex items-center gap-1"
                              >
                                <Edit3 size={10} /> Edit
                              </button>
                              {!msg.sent && (
                                <>
                                  <button
                                    onClick={() =>
                                      onUpdateMessage(msg.id, { sent: false })
                                    }
                                    className="text-[10px] px-2 py-1 text-muted hover:text-success hover:bg-success/10 rounded transition-colors flex items-center gap-1"
                                  >
                                    <Check size={10} /> Approve
                                  </button>
                                  <button
                                    onClick={() => handleMarkSent(msg.id)}
                                    className="text-[10px] px-2 py-1 text-muted hover:text-info hover:bg-info/10 rounded transition-colors flex items-center gap-1"
                                  >
                                    <Send size={10} /> Mark Sent
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => handleCopy(msg.id, msg.body)}
                                className="text-[10px] px-2 py-1 text-muted hover:text-foreground hover:bg-input rounded transition-colors flex items-center gap-1"
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={10} /> Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy size={10} /> Copy
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Approve thread */}
                    {thread.status === "draft" && (
                      <button
                        onClick={() => handleApproveThread(thread.id)}
                        className="w-full py-2 text-xs font-semibold text-success border border-success/30 rounded-lg hover:bg-success/10 transition-colors"
                      >
                        Approve {config.label} Lane
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Activity log */}
        {activity.length > 0 && (
          <div className="bg-card rounded-lg p-3 border border-border">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Activity Log
            </h3>
            <div className="space-y-2">
              {activity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-xs">
                  <Clock size={10} className="text-muted shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold text-secondary">
                      {entry.action}
                    </span>{" "}
                    <span className="text-muted">{entry.details}</span>
                    <div className="text-[10px] text-muted mt-0.5">
                      {new Date(entry.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
