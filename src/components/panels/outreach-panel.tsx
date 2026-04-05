"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Send,
  ChevronRight,
  ChevronDown,
  Clock,
  MessageCircle,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Zap,
  Mail,
  Phone,
  AtSign,
  Globe,
  User,
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
  refreshKey?: number;
  onDataChange?: () => void;
}

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

interface ContactPathData {
  type: string;
  name: string;
  role: string;
  email: string | null;
  channel: string;
  confidence: string;
  source_url: string | null;
}

interface ResearchedTarget {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  contactPaths: ContactPathData[];
}

export function OutreachPanel({ collapsed, onExpand, refreshKey, onDataChange }: Props) {
  const [threads, setThreads] = useState<ThreadWithData[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingPath, setGeneratingPath] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Gmail status
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailConfigured, setGmailConfigured] = useState(false);
  const [pushingDraft, setPushingDraft] = useState<string | null>(null);

  // Target selector state
  const [researchedTargets, setResearchedTargets] = useState<ResearchedTarget[]>([]);
  const [selectedOutreachTarget, setSelectedOutreachTarget] = useState<string>("");
  const [targetContactPaths, setTargetContactPaths] = useState<ContactPathData[]>([]);
  const [loadingPaths, setLoadingPaths] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);

  // Check Gmail connection status
  useEffect(() => {
    async function checkGmail() {
      try {
        const res = await fetch("/api/gmail");
        if (res.ok) {
          const data = await res.json();
          setGmailConnected(data.connected);
          setGmailConfigured(data.configured);
        }
      } catch { /* empty */ }
    }
    checkGmail();
  }, []);

  // Fetch threads
  useEffect(() => {
    fetchThreads();
  }, [refreshKey]);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/outreach");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setThreads(data);
      }
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch researched targets for the selector
  useEffect(() => {
    async function loadTargets() {
      try {
        const res = await fetch("/api/targets");
        if (!res.ok) return;
        const targets = await res.json();
        if (!Array.isArray(targets)) return;

        // Only show targets with research done
        const researched = targets
          .filter((t: Target) => ["researched", "drafted", "in_contact", "deck_sent", "pending_intro", "meeting_set"].includes(t.status))
          .map((t: Target) => ({
            id: t.id, name: t.name, type: t.type,
            status: t.status, priority: t.priority,
            contactPaths: [] as ContactPathData[],
          }));

        setResearchedTargets(researched);
      } catch {
        // empty
      }
    }
    loadTargets();
  }, [refreshKey]);

  // Load contact paths when a target is selected
  useEffect(() => {
    if (!selectedOutreachTarget) {
      setTargetContactPaths([]);
      return;
    }

    let cancelled = false;
    async function loadPaths() {
      setLoadingPaths(true);
      try {
        const res = await fetch(`/api/research?targetId=${selectedOutreachTarget}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setTargetContactPaths(data.contactPaths || []);
        }
      } catch {
        // empty
      } finally {
        if (!cancelled) setLoadingPaths(false);
      }
    }
    loadPaths();
    return () => { cancelled = true; };
  }, [selectedOutreachTarget]);

  // Stats
  const overdueCount = threads.filter((t) => {
    if (t.status === "active" || t.status === "approved") {
      const lastSent = t.messages.filter((m) => m.sent && m.sent_at)
        .sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""))[0];
      if (lastSent?.sent_at) {
        const daysSince = (Date.now() - new Date(lastSent.sent_at).getTime()) / (1000 * 60 * 60 * 24);
        return t.messages.find((m) => !m.sent) && daysSince > 3;
      }
    }
    return false;
  }).length;

  const responseCount = threads.filter((t) => t.messages.some((m) => m.response_text)).length;
  const draftCount = threads.filter((t) => t.status === "draft").length;

  // Group threads by target
  const threadsByTarget = threads.reduce<Record<string, { target: SelectedTarget; threads: ThreadWithData[] }>>((acc, thread) => {
    const targetId = thread.target_id;
    if (!acc[targetId]) {
      const t = thread.targets;
      acc[targetId] = {
        target: { id: targetId, name: t?.name || "Unknown", type: t?.type || "celebrity", status: t?.status || "new", priority: t?.priority || "medium", score: t?.score ?? null },
        threads: [],
      };
    }
    acc[targetId].threads.push(thread);
    return acc;
  }, {});

  // Generate outreach for a specific contact path
  const handleGenerateForPath = useCallback(
    async (targetId: string, contactPath: ContactPathData) => {
      setGenerating(true);
      setGeneratingPath(contactPath.type);
      setError(null);
      try {
        const res = await fetch("/api/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId,
            contactPathType: contactPath.type,
            contactPathName: contactPath.name,
            contactPathChannel: contactPath.channel,
            contactPathEmail: contactPath.email,
            contactPathRole: contactPath.role,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to generate outreach");
        } else {
          await fetchThreads();
          onDataChange?.();
          setShowGenerator(false);
        }
      } catch {
        setError("Network error generating outreach");
      } finally {
        setGenerating(false);
        setGeneratingPath(null);
      }
    },
    [fetchThreads, onDataChange]
  );

  // Message/thread update handlers
  const handleUpdateMessage = useCallback(async (messageId: string, updates: Partial<Message>) => {
    try {
      const res = await fetch("/api/outreach", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, ...updates }) });
      if (res.ok) {
        setThreads((prev) => prev.map((t) => ({ ...t, messages: t.messages.map((m) => m.id === messageId ? { ...m, ...updates } : m) })));
      }
    } catch { /* empty */ }
  }, []);

  // Push message to Gmail as draft
  const handlePushToGmail = useCallback(async (messageId: string, recipientEmail: string, subject: string, body: string) => {
    setPushingDraft(messageId);
    try {
      const res = await fetch("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_draft", messageId, to: recipientEmail, subject, body }),
      });
      const data = await res.json();
      if (data.success && data.mode === "gmail") {
        // Mark as ready and store draft info
        setError(null);
        alert(`Draft created in Gmail for ${recipientEmail}`);
      } else if (data.success && data.mode === "local") {
        setError("Gmail not connected. Draft saved locally only.");
      } else {
        setError(data.error || "Failed to create Gmail draft");
      }
    } catch {
      setError("Network error creating Gmail draft");
    } finally {
      setPushingDraft(null);
    }
  }, []);

  const handleUpdateThread = useCallback(async (threadId: string, updates: Partial<OutreachThread>) => {
    try {
      const res = await fetch("/api/outreach", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId, ...updates }) });
      if (res.ok) {
        setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, ...updates } : t));
      }
    } catch { /* empty */ }
  }, []);

  // ─── Collapsed ───
  if (collapsed) {
    return (
      <button onClick={onExpand} className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted hover:text-secondary transition-colors p-2">
        <Send size={20} />
        <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-lr]">Outreach</span>
      </button>
    );
  }

  // ─── Target detail view ───
  if (selectedTarget) {
    const targetThreads = threadsByTarget[selectedTarget.id]?.threads || [];
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 pb-0">
          <button onClick={() => setSelectedTarget(null)} className="flex items-center gap-1 text-xs text-muted hover:text-secondary mb-2">
            <ArrowLeft size={12} /> Back to threads
          </button>
        </div>
        <TargetThread target={selectedTarget} threads={targetThreads} research={[]} onClose={() => setSelectedTarget(null)} onUpdateMessage={handleUpdateMessage} onUpdateThread={handleUpdateThread} />
      </div>
    );
  }

  // ─── Main panel ───
  return (
    <div className="p-4 h-full flex flex-col" onClick={onExpand}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Outreach</h2>
        </div>
        <button onClick={(e) => { e.stopPropagation(); setShowGenerator(!showGenerator); }} className="text-xs text-primary hover:text-primary-hover font-semibold flex items-center gap-1">
          <Zap size={12} /> {showGenerator ? "Close" : "New Outreach"}
        </button>
      </div>

      {/* Gmail connection banner */}
      {gmailConfigured && !gmailConnected && (
        <a
          href="/api/auth/google"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2 mb-3 p-2.5 rounded-lg border border-warning/20 bg-warning/5 text-xs hover:bg-warning/10 transition-colors"
        >
          <Mail size={14} className="text-warning shrink-0" />
          <div className="flex-1">
            <span className="font-semibold text-warning">Connect Gmail</span>
            <span className="text-muted ml-1">to push drafts directly to Brixton&apos;s inbox</span>
          </div>
          <ChevronRight size={12} className="text-warning" />
        </a>
      )}
      {gmailConnected && (
        <div className="flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-lg bg-success/5 text-[10px] text-success">
          <Mail size={12} />
          <span className="font-semibold">Gmail connected</span>
          <span className="text-muted">— drafts push to inbox</span>
        </div>
      )}

      {/* ─── Generate Outreach Section ─── */}
      {showGenerator && (
        <div className="mb-4 bg-card border border-border rounded-lg p-3 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">Generate Outreach</h3>

          {/* Target selector */}
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Select Target</label>
            <select
              value={selectedOutreachTarget}
              onChange={(e) => setSelectedOutreachTarget(e.target.value)}
              className="w-full text-xs bg-input border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            >
              <option value="">Choose a researched target...</option>
              {researchedTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.type}) — {t.status}
                </option>
              ))}
            </select>
          </div>

          {/* Contact paths for selected target */}
          {selectedOutreachTarget && (
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider block mb-2">
                Contact Routes — ranked by confidence
              </label>

              {loadingPaths ? (
                <div className="text-center py-3">
                  <Loader2 size={14} className="mx-auto animate-spin text-muted" />
                </div>
              ) : targetContactPaths.length === 0 ? (
                <p className="text-xs text-muted">No contact paths found. Research this target first.</p>
              ) : (
                <div className="space-y-2">
                  {[...targetContactPaths]
                    .sort((a, b) => {
                      const conf = { high: 0, medium: 1, low: 2 };
                      return (conf[a.confidence as keyof typeof conf] ?? 2) - (conf[b.confidence as keyof typeof conf] ?? 2);
                    })
                    .map((cp, i) => (
                      <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-surface">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-bold uppercase">
                              {cp.type === "direct" ? "Direct" : cp.type === "agent" ? "Agent" : "Wildcard"}
                            </span>
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              cp.confidence === "high" ? "bg-success/20 text-success" :
                              cp.confidence === "medium" ? "bg-warning/20 text-warning" :
                              "bg-muted/20 text-muted"
                            }`}>
                              {cp.confidence}
                            </span>
                            {i === 0 && <span className="text-[9px] font-bold text-primary">RECOMMENDED</span>}
                          </div>
                          <p className="text-xs font-medium truncate">{cp.name}</p>
                          <p className="text-[10px] text-muted truncate">{cp.role}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {cp.email && (
                              <span className="text-[10px] text-primary flex items-center gap-0.5">
                                <Mail size={9} /> {cp.email}
                              </span>
                            )}
                            {cp.channel && !cp.email && (
                              <span className="text-[10px] text-muted flex items-center gap-0.5">
                                {cp.channel === "phone" ? <Phone size={9} /> :
                                 cp.channel === "instagram" ? <AtSign size={9} /> :
                                 cp.channel === "linkedin" ? <Globe size={9} /> :
                                 <Mail size={9} />}
                                {cp.channel}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGenerateForPath(selectedOutreachTarget, cp);
                          }}
                          disabled={generating}
                          className="shrink-0 px-3 py-2 text-[11px] font-semibold bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          {generating && generatingPath === cp.type ? (
                            <><Loader2 size={10} className="animate-spin" /> Drafting...</>
                          ) : (
                            <><Zap size={10} /> Draft</>
                          )}
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Action required */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Action Required</h3>
        <div className="space-y-2">
          <ActionCard icon={<AlertCircle size={14} className="text-danger" />} label="Overdue follow-ups" count={overdueCount} color="danger" />
          <ActionCard icon={<MessageCircle size={14} className="text-success" />} label="New responses" count={responseCount} color="success" />
          <ActionCard icon={<Clock size={14} className="text-warning" />} label="Drafts to review" count={draftCount} color="warning" />
        </div>
      </div>

      {/* Active threads */}
      <div className="flex-1 overflow-y-auto">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Active Threads</h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        ) : Object.keys(threadsByTarget).length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">
            <Send size={24} className="mx-auto mb-2 opacity-50" />
            <p>No active outreach</p>
            <p className="text-xs mt-1">Click &ldquo;New Outreach&rdquo; above to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {Object.entries(threadsByTarget).map(([targetId, { target, threads: targetThreads }]) => {
              const activeThread = targetThreads.find((t) => t.status === "active") || targetThreads.find((t) => t.status === "approved") || targetThreads[0];
              const currentMsg = activeThread?.messages.find((m) => !m.sent);
              const stage = currentMsg ? `M${currentMsg.sequence}` : "Done";
              const hasResponse = targetThreads.some((t) => t.messages.some((m) => m.response_text));

              const recipientEmail = activeThread?.recipient_email;

              return (
                <div key={targetId} className="rounded-lg border border-border bg-card overflow-hidden">
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedTarget(target); }}
                    className="w-full text-left p-3 hover:bg-card/80 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-foreground truncate">{target.name}</span>
                      <div className="flex items-center gap-1">
                        {hasResponse && <span className="w-2 h-2 rounded-full bg-success" />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted">
                      {targetThreads.map((t) => (
                        <span key={t.id} className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                          t.lane === "direct" ? "bg-primary/10 text-primary" :
                          t.lane === "agent" ? "bg-info/10 text-info" :
                          "bg-warning/10 text-warning"
                        }`}>
                          {t.lane}
                        </span>
                      ))}
                      <span className="ml-auto">{stage} — {activeThread?.status || "—"}</span>
                    </div>
                    {recipientEmail && (
                      <p className="text-[10px] text-muted mt-1 truncate">
                        <Mail size={9} className="inline mr-1" />{recipientEmail}
                      </p>
                    )}
                  </button>

                  {/* Push to Gmail button for next unsent message */}
                  {gmailConnected && currentMsg && recipientEmail && (
                    <div className="px-3 pb-2.5 pt-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePushToGmail(currentMsg.id, recipientEmail, currentMsg.subject, currentMsg.body);
                        }}
                        disabled={pushingDraft === currentMsg.id}
                        className="w-full py-1.5 text-[10px] font-semibold bg-success/10 text-success rounded hover:bg-success/20 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {pushingDraft === currentMsg.id ? (
                          <><Loader2 size={10} className="animate-spin" /> Pushing...</>
                        ) : (
                          <><Mail size={10} /> Push {stage} to Gmail</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-4 pt-2 mt-2 border-t border-border text-[10px] text-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> Direct</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-info" /> Agent</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Wildcard</span>
      </div>
    </div>
  );
}

function ActionCard({ icon, label, count, color }: { icon: React.ReactNode; label: string; count: number; color: string }) {
  const bgColors: Record<string, string> = { danger: "bg-danger/5 border-danger/10", success: "bg-success/5 border-success/10", warning: "bg-warning/5 border-warning/10" };
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${bgColors[color] || "bg-card border-border"}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-sm font-bold">{count}</span>
    </div>
  );
}
