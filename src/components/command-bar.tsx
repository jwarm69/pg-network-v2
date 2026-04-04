"use client";

import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Send, Loader2, Undo2, Plus } from "lucide-react";

interface CommandAction {
  type: string;
  targetId?: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  target?: string;
  query?: string;
}

interface HistoryEntry {
  input: string;
  response: string;
  intent: string;
  confidence: number;
  action?: CommandAction;
  timestamp: Date;
  undone?: boolean;
}

interface DiscoveryResult {
  name: string;
  description: string;
  relevance: "high" | "medium" | "low";
  golfConnection: string;
  estimatedReach: string;
}

export interface CommandBarHandle {
  focus: () => void;
  collapse: () => boolean;
}

interface CommandBarProps {
  onDiscoveryResults?: (results: DiscoveryResult[]) => void;
}

export const CommandBar = forwardRef<CommandBarHandle, CommandBarProps>(function CommandBar({ onDiscoveryResults }, ref) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus() {
      inputRef.current?.focus();
    },
    collapse() {
      if (expanded) {
        setExpanded(false);
        setMobileExpanded(false);
        return true;
      }
      if (mobileExpanded) {
        setMobileExpanded(false);
        inputRef.current?.blur();
        return true;
      }
      return false;
    },
  }));

  // Scroll history to bottom when new entries added
  useEffect(() => {
    if (expanded && historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [history, expanded]);

  // Cmd+K keyboard shortcut to focus command bar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setMobileExpanded(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Get past command inputs for up-arrow cycling
  const pastCommands = history.map((h) => h.input);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSubmit();
      return;
    }

    if (e.key === "ArrowUp" && pastCommands.length > 0) {
      e.preventDefault();
      const nextIndex = commandIndex < pastCommands.length - 1 ? commandIndex + 1 : commandIndex;
      setCommandIndex(nextIndex);
      setInput(pastCommands[pastCommands.length - 1 - nextIndex]);
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (commandIndex > 0) {
        const nextIndex = commandIndex - 1;
        setCommandIndex(nextIndex);
        setInput(pastCommands[pastCommands.length - 1 - nextIndex]);
      } else {
        setCommandIndex(-1);
        setInput("");
      }
    }

    if (e.key === "Escape") {
      setMobileExpanded(false);
      setExpanded(false);
      inputRef.current?.blur();
    }
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setInput("");
    setCommandIndex(-1);
    setExpanded(true);

    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text }),
      });
      const data = await res.json();
      const response = data.response || data.error || "No response";
      const intent = data.intent || "UNKNOWN";
      const confidence = data.confidence ?? 0;
      const action = data.action as CommandAction | undefined;

      const entry: HistoryEntry = { input: text, response, intent, confidence, action, timestamp: new Date() };
      setHistory((h) => [...h, entry]);
      setLastResponse(response);

      // If discovery results came back, push them to the Research panel
      if (action?.discoveryResults && onDiscoveryResults) {
        onDiscoveryResults(action.discoveryResults as DiscoveryResult[]);
      }
    } catch {
      const errorMsg = "Offline. Try again.";
      setHistory((h) => [...h, { input: text, response: errorMsg, intent: "ERROR", confidence: 0, timestamp: new Date() }]);
      setLastResponse(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  const handleUndo = useCallback(async (entryIndex: number) => {
    const entry = history[entryIndex];
    if (!entry.action || entry.action.type !== "UPDATE_FIELD" || entry.undone) return;

    try {
      const res = await fetch("/api/targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.action.targetId,
          [entry.action.field!]: entry.action.oldValue,
        }),
      });

      if (res.ok) {
        setHistory((h) =>
          h.map((item, i) =>
            i === entryIndex ? { ...item, undone: true, response: item.response + "\n(Undone)" } : item
          )
        );
      }
    } catch {
      // Silently fail
    }
  }, [history]);

  const handleAddToPipeline = useCallback(async (name: string) => {
    try {
      await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: "organic",
          status: "new",
          priority: "medium",
          channel: "email",
          notes: "Added from Command Center discovery",
        }),
      });
    } catch {
      // Silently fail
    }
  }, []);

  function renderResponse(entry: HistoryEntry, index: number) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-secondary whitespace-pre-wrap leading-relaxed pl-5">
          {entry.response}
        </p>
        {/* Only show action buttons when relevant */}
        {(entry.action?.type === "UPDATE_FIELD" && !entry.undone) || entry.intent === "DISCOVERY" ? (
          <div className="flex items-center gap-3 pl-5">
            {entry.action?.type === "UPDATE_FIELD" && !entry.undone && (
              <button
                onClick={() => handleUndo(index)}
                className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
              >
                <Undo2 size={11} />
                Undo
              </button>
            )}
            {entry.intent === "DISCOVERY" && (
              <button
                onClick={() => handleAddToPipeline(entry.action?.query || "Discovery Target")}
                className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <Plus size={11} />
                Add to Pipeline
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // Mobile: tapping the command bar input expands to near-full-screen
  function handleMobileFocus() {
    setMobileExpanded(true);
    if (history.length > 0) {
      setExpanded(true);
    }
  }

  return (
    <div
      className={`border-t border-border bg-card shrink-0 transition-all duration-200 ${
        mobileExpanded ? "md:relative fixed inset-x-0 bottom-0 z-50 max-h-[80vh] flex flex-col" : ""
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Mobile overlay backdrop */}
      {mobileExpanded && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 -z-10"
          onClick={() => {
            setMobileExpanded(false);
            setExpanded(false);
            inputRef.current?.blur();
          }}
        />
      )}

      {/* History panel — only shows when expanded AND has content */}
      {expanded && history.length > 0 && (
        <div
          ref={historyRef}
          className={`overflow-y-auto border-b border-border px-4 py-3 space-y-4 ${
            mobileExpanded ? "flex-1 max-h-[65vh]" : "max-h-64"
          }`}
        >
          {history.map((entry, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-start gap-2">
                <span className="text-primary text-xs font-mono mt-0.5">&gt;</span>
                <span className="text-xs text-foreground font-medium">{entry.input}</span>
              </div>
              {renderResponse(entry, i)}
            </div>
          ))}
        </div>
      )}

      {/* Last response preview (collapsed, not on mobile expanded) */}
      {!expanded && !mobileExpanded && lastResponse && (
        <button
          onClick={() => { setExpanded(true); setMobileExpanded(true); }}
          className="w-full px-4 py-2 border-b border-border flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
        >
          <p className="text-xs text-secondary truncate flex-1">{lastResponse}</p>
        </button>
      )}

      {/* Input bar */}
      <div className="flex items-center gap-3 px-4 py-3.5 md:py-2.5">
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask anything..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleMobileFocus}
          disabled={loading}
          className="flex-1 bg-transparent text-base md:text-sm outline-none placeholder:text-muted/60 disabled:opacity-50"
        />

        {loading && (
          <Loader2 size={20} className="animate-spin text-primary shrink-0" />
        )}

        {!loading && (
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="shrink-0 p-2.5 md:p-1.5 rounded-full bg-primary text-white disabled:bg-muted/20 disabled:text-muted transition-colors"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
});
