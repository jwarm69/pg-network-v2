"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ResearchPanel } from "@/components/panels/research-panel";
import { OutreachPanel } from "@/components/panels/outreach-panel";
import { DatabasePanel } from "@/components/panels/database-panel";
import { CommandBar, type CommandBarHandle } from "@/components/command-bar";
import { FlaskConical, Send, Database } from "lucide-react";

type Panel = "research" | "outreach" | "database";

const PANEL_ORDER: Panel[] = ["research", "outreach", "database"];

export default function Dashboard() {
  const [activePanel, setActivePanel] = useState<Panel>("outreach");
  const [expandedPanel, setExpandedPanel] = useState<Panel | null>(null);
  const commandBarRef = useRef<CommandBarHandle>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  function handlePanelClick(panel: Panel) {
    if (expandedPanel === panel) {
      setExpandedPanel(null);
    } else {
      setExpandedPanel(panel);
      setActivePanel(panel);
    }
  }

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "k") {
        e.preventDefault();
        commandBarRef.current?.focus();
        return;
      }

      if (meta && e.key >= "1" && e.key <= "3") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        setActivePanel(PANEL_ORDER[idx]);
        return;
      }

      if (e.key === "Escape") {
        if (commandBarRef.current?.collapse()) return;
        if (expandedPanel) {
          setExpandedPanel(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedPanel]);


  return (
    <div className="flex flex-col h-screen">
      {/* Header — compact on mobile, spacious on desktop */}
      <header className="bg-card border-b border-border px-4 md:px-6 py-2.5 md:py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 md:w-auto md:h-auto rounded-lg md:rounded-none bg-primary/10 md:bg-transparent flex items-center justify-center md:block">
            <h1 className="text-sm md:text-lg font-extrabold text-primary tracking-tight leading-none">PG</h1>
          </div>
          <div className="hidden md:block">
            <h1 className="text-lg font-extrabold text-primary tracking-tight">PG Network</h1>
            <p className="text-[10px] font-medium uppercase tracking-widest text-secondary">
              Networking Intelligence
            </p>
          </div>
          <div className="md:hidden">
            <h1 className="text-base font-extrabold text-primary tracking-tight leading-tight">Network</h1>
          </div>
        </div>
        <StatusLine />
      </header>

      {/* Mobile tab bar */}
      <MobileTabBar activePanel={activePanel} onSwitch={setActivePanel} />

      {/* 3-panel layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Desktop: 3 columns */}
        <div className="hidden md:flex flex-1 overflow-hidden">
          <div
            className={`border-r border-border overflow-y-auto transition-all duration-300 ${
              expandedPanel === "research"
                ? "flex-[3]"
                : expandedPanel
                  ? "flex-[0.5] min-w-[60px]"
                  : "flex-1"
            }`}
          >
            <ResearchPanel
              collapsed={expandedPanel !== null && expandedPanel !== "research"}
              onExpand={() => handlePanelClick("research")}
              refreshKey={refreshKey}
              onDataChange={triggerRefresh}
            />
          </div>
          <div
            className={`border-r border-border overflow-y-auto transition-all duration-300 ${
              expandedPanel === "outreach"
                ? "flex-[3]"
                : expandedPanel
                  ? "flex-[0.5] min-w-[60px]"
                  : "flex-[1.5]"
            }`}
          >
            <OutreachPanel
              collapsed={expandedPanel !== null && expandedPanel !== "outreach"}
              onExpand={() => handlePanelClick("outreach")}
              refreshKey={refreshKey}
              onDataChange={triggerRefresh}
            />
          </div>
          <div
            className={`overflow-y-auto transition-all duration-300 ${
              expandedPanel === "database"
                ? "flex-[3]"
                : expandedPanel
                  ? "flex-[0.5] min-w-[60px]"
                  : "flex-1"
            }`}
          >
            <DatabasePanel
              collapsed={expandedPanel !== null && expandedPanel !== "database"}
              onExpand={() => handlePanelClick("database")}
              refreshKey={refreshKey}
              onDataChange={triggerRefresh}
            />
          </div>
        </div>

        {/* Mobile: single active panel with animation */}
        <div className="md:hidden flex-1 overflow-y-auto hide-scrollbar animate-fade-in-up" key={activePanel}>
          {activePanel === "research" && <ResearchPanel collapsed={false} onExpand={() => {}} refreshKey={refreshKey} onDataChange={triggerRefresh} />}
          {activePanel === "outreach" && <OutreachPanel collapsed={false} onExpand={() => {}} refreshKey={refreshKey} onDataChange={triggerRefresh} />}
          {activePanel === "database" && <DatabasePanel collapsed={false} onExpand={() => {}} refreshKey={refreshKey} onDataChange={triggerRefresh} />}
        </div>
      </main>

      {/* Command Bar -- always visible */}
      <CommandBar
        ref={commandBarRef}
        onAction={(action) => {
          if (action.type === "RESEARCH_CMD" || action.type === "DISCOVERY") {
            setActivePanel("research");
            setExpandedPanel("research");
            triggerRefresh();
          } else if (action.type === "MESSAGE_CMD") {
            setActivePanel("outreach");
            setExpandedPanel("outreach");
            triggerRefresh();
          } else if (action.type === "UPDATE_FIELD") {
            triggerRefresh();
          }
        }}
      />
    </div>
  );
}

// ─── Status Line ───

interface StatusCounts {
  overdue: number;
  responses: number;
  active: number;
}

function StatusLine() {
  const [counts, setCounts] = useState<StatusCounts>({ overdue: 0, responses: 0, active: 0 });
  const [prevCounts, setPrevCounts] = useState<StatusCounts>({ overdue: 0, responses: 0, active: 0 });
  const [pulsingField, setPulsingField] = useState<string | null>(null);
  const [highlightedStat, setHighlightedStat] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const res = await fetch("/api/targets");
        if (!res.ok) return;
        const targets = await res.json();
        if (!Array.isArray(targets)) return;

        const now = new Date();
        let overdue = 0;
        let responses = 0;
        let active = 0;

        for (const t of targets) {
          // Count active targets (statuses indicating active outreach)
          const activeStatuses = ["drafted", "deck_sent", "in_contact", "pending_intro", "meeting_set"];
          if (activeStatuses.includes(t.status)) {
            active++;
          }

          // Count overdue: targets with updated_at > 7 days ago that are in active statuses
          if (activeStatuses.includes(t.status) && t.updated_at) {
            const updated = new Date(t.updated_at);
            const daysSince = (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince > 7) {
              overdue++;
            }
          }

          // Count responses: targets in "in_contact" status (indicating they responded)
          if (t.status === "in_contact") {
            responses++;
          }
        }

        setCounts((prev) => {
          setPrevCounts(prev);
          return { overdue, responses, active };
        });
      } catch {
        // Silently fail — keep showing current counts
      }
    }

    fetchCounts();
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Detect changes and trigger pulse
  useEffect(() => {
    if (counts.overdue !== prevCounts.overdue) setPulsingField("overdue");
    else if (counts.responses !== prevCounts.responses) setPulsingField("responses");
    else if (counts.active !== prevCounts.active) setPulsingField("active");

    if (pulsingField) {
      const timer = setTimeout(() => setPulsingField(null), 500);
      return () => clearTimeout(timer);
    }
  }, [counts, prevCounts, pulsingField]);

  function handleStatClick(stat: string) {
    setHighlightedStat((prev) => (prev === stat ? null : stat));
  }

  const statClass = (field: string) =>
    `cursor-pointer transition-all rounded px-1.5 py-0.5 -mx-1.5 -my-0.5 ${
      highlightedStat === field ? "bg-primary/10 text-foreground" : "hover:bg-white/5"
    }`;

  return (
    <>
      {/* Desktop version */}
      <div className="hidden sm:flex gap-4 text-xs text-secondary">
        <button onClick={() => handleStatClick("overdue")} className={statClass("overdue")}>
          <strong className={`text-foreground ${pulsingField === "overdue" ? "animate-stat-pulse inline-block" : ""}`}>
            {counts.overdue}
          </strong>{" "}
          overdue
        </button>
        <button onClick={() => handleStatClick("responses")} className={statClass("responses")}>
          <strong className={`text-foreground ${pulsingField === "responses" ? "animate-stat-pulse inline-block" : ""}`}>
            {counts.responses}
          </strong>{" "}
          responses
        </button>
        <button onClick={() => handleStatClick("active")} className={statClass("active")}>
          <strong className={`text-foreground ${pulsingField === "active" ? "animate-stat-pulse inline-block" : ""}`}>
            {counts.active}
          </strong>{" "}
          active
        </button>
      </div>
      {/* Mobile version — pill badges */}
      <div className="sm:hidden flex items-center gap-1.5">
        {counts.overdue > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-semibold bg-danger/15 text-danger px-2 py-0.5 rounded-full">
            {counts.overdue}
            <span className="text-[8px] uppercase">due</span>
          </span>
        )}
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-success/15 text-success px-2 py-0.5 rounded-full">
          {counts.responses}
          <span className="text-[8px] uppercase">rsp</span>
        </span>
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-info/15 text-info px-2 py-0.5 rounded-full">
          {counts.active}
          <span className="text-[8px] uppercase">act</span>
        </span>
      </div>
    </>
  );
}

// ─── Mobile Tab Bar with badge counts ───

function MobileTabBar({
  activePanel,
  onSwitch,
}: {
  activePanel: Panel;
  onSwitch: (p: Panel) => void;
}) {
  const [badgeCounts, setBadgeCounts] = useState<Record<Panel, number>>({
    research: 0,
    outreach: 0,
    database: 0,
  });

  useEffect(() => {
    async function fetchBadges() {
      try {
        const res = await fetch("/api/targets");
        if (!res.ok) return;
        const targets = await res.json();
        if (!Array.isArray(targets)) return;

        // Research: targets with status "new" (need research)
        const needResearch = targets.filter((t: { status: string }) => t.status === "new").length;
        // Outreach: targets with active outreach statuses
        const activeOutreach = targets.filter((t: { status: string }) =>
          ["drafted", "deck_sent", "in_contact", "pending_intro"].includes(t.status),
        ).length;
        // Database: total targets
        const total = targets.length;

        setBadgeCounts({ research: needResearch, outreach: activeOutreach, database: total });
      } catch {
        // Keep zeros
      }
    }

    fetchBadges();
    const interval = setInterval(fetchBadges, 30000);
    return () => clearInterval(interval);
  }, []);

  const tabs: Record<Panel, { label: string; icon: React.ReactNode }> = {
    research: { label: "Research", icon: <FlaskConical size={16} /> },
    outreach: { label: "Outreach", icon: <Send size={16} /> },
    database: { label: "Leads", icon: <Database size={16} /> },
  };

  return (
    <nav
      className="md:hidden flex border-b border-border bg-card/80 backdrop-blur-sm"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      {PANEL_ORDER.map((p) => {
        const isActive = activePanel === p;
        const tab = tabs[p];
        return (
          <button
            key={p}
            onClick={() => onSwitch(p)}
            className={`flex-1 py-2.5 flex flex-col items-center gap-1 transition-all duration-200 relative mobile-press ${
              isActive
                ? "text-primary"
                : "text-muted active:text-secondary"
            }`}
          >
            <div className={`relative ${isActive ? "text-primary" : ""}`}>
              {tab.icon}
              {badgeCounts[p] > 0 && (
                <span className={`absolute -top-1.5 -right-3 min-w-[14px] h-3.5 px-1 flex items-center justify-center text-[8px] font-bold rounded-full leading-none ${
                  isActive ? "bg-primary text-white" : "bg-muted/30 text-secondary"
                }`}>
                  {badgeCounts[p] > 99 ? "99+" : badgeCounts[p]}
                </span>
              )}
            </div>
            <span className="text-[9px] font-semibold uppercase tracking-wider">{tab.label}</span>
            {/* Active indicator bar */}
            {isActive && (
              <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
