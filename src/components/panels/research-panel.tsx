"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  FlaskConical,
  ChevronRight,
  ChevronDown,
  Plus,
  Loader2,
  ExternalLink,
  AlertTriangle,
  UserPlus,
  FileSearch,
  X,
} from "lucide-react";

interface Props {
  collapsed: boolean;
  onExpand: () => void;
}

interface DiscoveryResult {
  name: string;
  description: string;
  relevance: "high" | "medium" | "low";
  golfConnection: string;
  estimatedReach: string;
}

interface QueueTarget {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
}

interface Dossier {
  bio: string;
  golfConnection: string;
  reach: string;
  contactIntel: string;
  recentActivity: string;
  sources: string[];
  partnershipAngle?: string;
  riskFlags?: string[];
}

interface ResearchField {
  field: string;
  value: string;
}

export function ResearchPanel({ collapsed, onExpand }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [discoveryMock, setDiscoveryMock] = useState(false);

  const [queue, setQueue] = useState<QueueTarget[]>([]);
  const [researchedTargets, setResearchedTargets] = useState<QueueTarget[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  const [researchingId, setResearchingId] = useState<string | null>(null);
  const [dossiers, setDossiers] = useState<Record<string, Dossier>>({});
  const [expandedDossier, setExpandedDossier] = useState<string | null>(null);
  const [addingTarget, setAddingTarget] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [needResearchCount, setNeedResearchCount] = useState(0);
  const [researchedCount, setResearchedCount] = useState(0);

  // Fetch targets for queue and stats
  const fetchTargets = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const res = await fetch("/api/targets");
      if (!res.ok) return;
      const targets: QueueTarget[] = await res.json();

      const needsResearch = targets.filter((t) => t.status === "new");
      const researched = targets.filter((t) => t.status === "researched");

      setQueue(needsResearch);
      setResearchedTargets(researched);
      setNeedResearchCount(needsResearch.length);
      setResearchedCount(researched.length);
    } catch {
      // silently fail — might not have Supabase configured
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  if (collapsed) {
    return (
      <button
        onClick={onExpand}
        className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted hover:text-secondary transition-colors p-2"
      >
        <FlaskConical size={20} />
        <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-lr]">
          Research
        </span>
      </button>
    );
  }

  // ── Discovery search ──
  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setDiscoveryResults([]);
    setDiscoveryMock(false);
    setSearchError(null);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSearchError(data.error || `Search failed (${res.status})`);
        return;
      }

      if (data.error) {
        setSearchError(data.error);
        return;
      }

      setDiscoveryResults(data.results || []);
      setDiscoveryMock(!!data.mock);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed — check network");
    } finally {
      setSearching(false);
    }
  }

  // ── Run research on a target ──
  async function runResearch(targetId: string) {
    setResearchingId(targetId);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });

      if (!res.ok) throw new Error("Research failed");

      const data = await res.json();
      if (data.dossier) {
        setDossiers((prev) => ({ ...prev, [targetId]: data.dossier }));
        setExpandedDossier(targetId);
      }

      // Refresh queue
      await fetchTargets();
    } catch {
      // error handled silently
    } finally {
      setResearchingId(null);
    }
  }

  // ── Add discovery result as a target ──
  async function addToPipeline(result: DiscoveryResult) {
    setAddingTarget(result.name);
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: result.name,
          type: "celebrity",
          status: "new",
          priority: result.relevance === "high" ? "high" : result.relevance === "medium" ? "medium" : "low",
          channel: "",
          notes: `${result.description}\nGolf connection: ${result.golfConnection}\nEstimated reach: ${result.estimatedReach}`,
        }),
      });

      if (res.ok) {
        await fetchTargets();
        // Remove from discovery results
        setDiscoveryResults((prev) => prev.filter((r) => r.name !== result.name));
      }
    } catch {
      // silently fail
    } finally {
      setAddingTarget(null);
    }
  }

  return (
    <div className="p-4 h-full flex flex-col" onClick={onExpand}>
      {/* Panel header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Research Hub</h2>
        </div>
        <button className="text-xs text-muted hover:text-secondary flex items-center gap-1">
          View all <ChevronRight size={12} />
        </button>
      </div>

      {/* Discovery search */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Find targets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full pl-8 pr-3 py-3 md:py-2 text-sm bg-input border border-border rounded-lg outline-none focus:border-primary transition-colors"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching}
          className="px-5 md:px-3 py-3 md:py-2 text-sm md:text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : "Go"}
        </button>
      </div>

      {/* Error display */}
      {searchError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="break-all">{searchError}</span>
          <button onClick={() => setSearchError(null)} className="ml-auto shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Discovery results */}
      {discoveryResults.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Discovery Results
            </h3>
            <button
              onClick={() => setDiscoveryResults([])}
              className="text-muted hover:text-secondary"
            >
              <X size={12} />
            </button>
          </div>
          {discoveryMock && (
            <div className="flex items-center gap-1 text-[10px] text-warning mb-2 bg-warning/10 rounded px-2 py-1">
              <AlertTriangle size={10} />
              <span>Mock data — configure API keys for real results</span>
            </div>
          )}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {discoveryResults.map((result, i) => (
              <DiscoveryCard
                key={i}
                result={result}
                onAdd={() => addToPipeline(result)}
                adding={addingTarget === result.name}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <StatCard
          label="Need Research"
          value={String(needResearchCount)}
          accent="warning"
        />
        <StatCard
          label="Researched"
          value={String(researchedCount)}
          accent="success"
        />
      </div>

      {/* Queue + researched */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Research queue (new targets) */}
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          Research Queue
        </h3>

        {loadingQueue ? (
          <div className="text-center py-4">
            <Loader2 size={16} className="mx-auto animate-spin text-muted" />
          </div>
        ) : queue.length === 0 ? (
          <div className="text-center py-6 text-muted text-sm">
            <FlaskConical size={24} className="mx-auto mb-2 opacity-50" />
            <p>No targets in queue</p>
            <p className="text-xs mt-1">Search above or add from the Leads panel</p>
          </div>
        ) : (
          <div className="space-y-1 mb-4">
            {queue.map((target) => (
              <QueueItem
                key={target.id}
                target={target}
                onRunResearch={() => runResearch(target.id)}
                isResearching={researchingId === target.id}
              />
            ))}
          </div>
        )}

        {/* Researched targets with dossiers */}
        {researchedTargets.length > 0 && (
          <>
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 mt-4">
              Researched
            </h3>
            <div className="space-y-1">
              {researchedTargets.map((target) => (
                <div key={target.id}>
                  <button
                    onClick={() =>
                      setExpandedDossier(
                        expandedDossier === target.id ? null : target.id
                      )
                    }
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-card hover:bg-card-hover transition-colors text-left"
                  >
                    {expandedDossier === target.id ? (
                      <ChevronDown size={12} className="text-muted shrink-0" />
                    ) : (
                      <ChevronRight size={12} className="text-muted shrink-0" />
                    )}
                    <FileSearch size={12} className="text-success shrink-0" />
                    <span className="font-medium truncate flex-1">
                      {target.name}
                    </span>
                    <span className="text-[10px] text-success uppercase font-semibold">
                      Done
                    </span>
                  </button>

                  {expandedDossier === target.id && (
                    <DossierView
                      targetId={target.id}
                      dossier={dossiers[target.id]}
                      onLoadDossier={(d) =>
                        setDossiers((prev) => ({ ...prev, [target.id]: d }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Quick add */}
      <button className="mt-2 w-full py-2 border border-dashed border-border-light rounded-lg text-xs text-muted hover:text-secondary hover:border-secondary transition-colors flex items-center justify-center gap-1">
        <Plus size={12} /> Add target for research
      </button>
    </div>
  );
}

// ─── Sub-components ───

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  const accentColors: Record<string, string> = {
    warning: "border-b-2 border-warning/30",
    success: "border-b-2 border-success/30",
    primary: "border-b-2 border-primary/30",
    info: "border-b-2 border-info/30",
  };

  return (
    <div className={`bg-card rounded-xl p-3 ${accentColors[accent] || ""}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
        {label}
      </p>
      <p className="text-xl font-extrabold">{value}</p>
    </div>
  );
}

function DiscoveryCard({
  result,
  onAdd,
  adding,
}: {
  result: DiscoveryResult;
  onAdd: () => void;
  adding: boolean;
}) {
  const relevanceColor =
    result.relevance === "high"
      ? "text-success"
      : result.relevance === "medium"
        ? "text-warning"
        : "text-muted";

  return (
    <div className="bg-card rounded-lg p-3 border border-border">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-semibold text-sm">{result.name}</span>
        <span
          className={`text-[10px] uppercase font-bold shrink-0 ${relevanceColor}`}
        >
          {result.relevance}
        </span>
      </div>
      <p className="text-xs text-muted mb-1 line-clamp-2">{result.description}</p>
      {result.golfConnection && (
        <p className="text-[10px] text-muted mb-1">
          <span className="font-semibold">Golf:</span> {result.golfConnection}
        </p>
      )}
      {result.estimatedReach && (
        <p className="text-[10px] text-muted mb-2">
          <span className="font-semibold">Reach:</span> {result.estimatedReach}
        </p>
      )}
      <button
        onClick={onAdd}
        disabled={adding}
        className="w-full py-2.5 md:py-1.5 text-xs md:text-[11px] font-semibold bg-primary/10 text-primary rounded-lg md:rounded hover:bg-primary/20 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
      >
        {adding ? (
          <Loader2 size={10} className="animate-spin" />
        ) : (
          <UserPlus size={10} />
        )}
        {adding ? "Adding..." : "Add to Pipeline"}
      </button>
    </div>
  );
}

function QueueItem({
  target,
  onRunResearch,
  isResearching,
}: {
  target: QueueTarget;
  onRunResearch: () => void;
  isResearching: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{target.name}</p>
        <p className="text-[10px] text-muted capitalize">
          {target.type} &middot; {target.priority} priority
        </p>
      </div>
      <button
        onClick={onRunResearch}
        disabled={isResearching}
        className="shrink-0 px-3.5 py-2.5 md:px-2.5 md:py-1.5 text-xs md:text-[11px] font-semibold bg-primary text-white rounded-lg md:rounded hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center gap-1"
      >
        {isResearching ? (
          <>
            <Loader2 size={10} className="animate-spin" />
            Running...
          </>
        ) : (
          <>
            <FlaskConical size={10} />
            Research
          </>
        )}
      </button>
    </div>
  );
}

function DossierView({
  targetId,
  dossier,
  onLoadDossier,
}: {
  targetId: string;
  dossier?: Dossier;
  onLoadDossier: (d: Dossier) => void;
}) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (dossier || loading) return;

    // Fetch research data for this target from the research fields
    async function loadResearch() {
      setLoading(true);
      try {
        const res = await fetch(`/api/research?targetId=${targetId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.fields && Array.isArray(data.fields)) {
          const fieldMap: Record<string, string> = {};
          data.fields.forEach((f: ResearchField) => {
            fieldMap[f.field] = f.value;
          });
          onLoadDossier({
            bio: fieldMap.bio || "No bio available",
            golfConnection: fieldMap.golf_connection || "Unknown",
            reach: fieldMap.reach || "Unknown",
            contactIntel: fieldMap.contact_intel || "Unknown",
            recentActivity: fieldMap.recent_activity || "Unknown",
            sources: [],
            partnershipAngle: fieldMap.partnership_angle,
            riskFlags: fieldMap.risk_flags
              ? fieldMap.risk_flags.split("; ").filter(Boolean)
              : [],
          });
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }

    loadResearch();
  }, [targetId, dossier, loading, onLoadDossier]);

  if (loading) {
    return (
      <div className="px-3 py-4 text-center">
        <Loader2 size={14} className="mx-auto animate-spin text-muted" />
        <p className="text-xs text-muted mt-1">Loading dossier...</p>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="px-3 py-2 text-xs text-muted">
        No research data found. Click &quot;Research&quot; to generate a dossier.
      </div>
    );
  }

  return (
    <div className="mx-1 mt-1 mb-2 bg-card border border-border rounded-lg p-3 space-y-3">
      <DossierSection label="Bio" value={dossier.bio} />
      <DossierSection label="Golf Connection" value={dossier.golfConnection} />
      <DossierSection label="Reach" value={dossier.reach} />
      <DossierSection label="Contact Intel" value={dossier.contactIntel} />
      <DossierSection label="Recent Activity" value={dossier.recentActivity} />
      {dossier.partnershipAngle && (
        <DossierSection label="Partnership Angle" value={dossier.partnershipAngle} />
      )}
      {dossier.riskFlags && dossier.riskFlags.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-warning mb-1 flex items-center gap-1">
            <AlertTriangle size={10} /> Risk Flags
          </p>
          <ul className="text-xs text-muted space-y-0.5">
            {dossier.riskFlags.map((flag, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="text-warning mt-0.5">*</span> {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dossier.sources && dossier.sources.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
            Sources
          </p>
          <div className="space-y-0.5">
            {dossier.sources.map((src, i) => (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary hover:underline flex items-center gap-1 truncate"
              >
                <ExternalLink size={8} /> {src}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DossierSection({ label, value }: { label: string; value: string }) {
  const isUnknown = value.startsWith("UNKNOWN");

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">
        {label}
      </p>
      <p className={`text-xs ${isUnknown ? "text-warning italic" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
