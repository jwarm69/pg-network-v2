"use client";

import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Terminal, Send, Loader2, ChevronUp, ChevronDown, Undo2, Plus } from "lucide-react";

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

export interface CommandBarHandle {
  focus: () => void;
  collapse: () => boolean;
}

export const CommandBar = forwardRef<CommandBarHandle>(function CommandBar(_props, ref) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [lastIntent, setLastIntent] = useState<string | null>(null);
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
      inputRef.current?.blur();
    }
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setInput("");
    setCommandIndex(-1);

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
      setLastIntent(intent);
    } catch {
      const errorMsg = "Command center offline. Try again later.";
      setHistory((h) => [...h, { input: text, response: errorMsg, intent: "ERROR", confidence: 0, timestamp: new Date() }]);
      setLastResponse(errorMsg);
      setLastIntent("ERROR");
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

  function intentBadge(intent: string) {
    const colors: Record<string, string> = {
      STATUS_QUERY: "text-blue-400",
      UPDATE_FIELD: "text-amber-400",
      RESEARCH_CMD: "text-purple-400",
      MESSAGE_CMD: "text-green-400",
      DISCOVERY: "text-cyan-400",
      GENERAL_CHAT: "text-muted",
      ERROR: "text-red-400",
    };
    return (
      <span className={`text-[9px] font-mono uppercase ${colors[intent] || "text-muted"}`}>
        {intent.replace("_", " ")}
      </span>
    );
  }

  function renderResponse(entry: HistoryEntry, index: number) {
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2 pl-4">
          <span className="text-xs text-secondary whitespace-pre-wrap flex-1">{entry.response}</span>
        </div>
        <div className="flex items-center gap-2 pl-4">
          {intentBadge(entry.intent)}
          {entry.action?.type === "UPDATE_FIELD" && !entry.undone && (
            <button
              onClick={() => handleUndo(index)}
              className="inline-flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
            >
              <Undo2 size={10} />
              Undo
            </button>
          )}
          {entry.intent === "DISCOVERY" && (
            <button
              onClick={() => handleAddToPipeline(entry.action?.query || "Discovery Target")}
              className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              <Plus size={10} />
              Add to Pipeline
            </button>
          )}
        </div>
      </div>
    );
  }

  // Mobile: tapping the command bar input expands to near-full-screen
  function handleMobileFocus() {
    setMobileExpanded(true);
    setExpanded(true);
  }

  return (
    <div
      className={`border-t border-border bg-card shrink-0 transition-all duration-200 ${
        mobileExpanded ? "md:relative fixed inset-x-0 bottom-0 z-50 max-h-[85vh] flex flex-col" : ""
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Mobile overlay backdrop */}
      {mobileExpanded && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 -z-10"
          onClick={() => setMobileExpanded(false)}
        />
      )}

      {/* Expandable history */}
      {expanded && (
        <div
          ref={historyRef}
          className={`overflow-y-auto border-b border-border px-4 py-2 space-y-3 ${
            mobileExpanded ? "flex-1 max-h-[70vh]" : "max-h-64"
          }`}
        >
          {history.length === 0 ? (
            <p className="text-xs text-muted py-4 text-center">
              Command history will appear here. Try &quot;status&quot;, &quot;research [name]&quot;, or &quot;discover golf podcasts&quot;
              <br />
              <span className="text-[10px]">Cmd+K to focus &middot; Up arrow for previous commands</span>
            </p>
          ) : (
            history.map((entry, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-primary text-xs font-mono mt-0.5">&gt;</span>
                  <span className="text-xs text-foreground">{entry.input}</span>
                </div>
                {renderResponse(entry, i)}
              </div>
            ))
          )}
        </div>
      )}

      {/* Last response preview (when not expanded) */}
      {!expanded && lastResponse && (
        <div className="px-4 py-1.5 border-b border-border flex items-center gap-2">
          <p className="text-xs text-secondary truncate flex-1">{lastResponse}</p>
          {lastIntent && intentBadge(lastIntent)}
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          onClick={() => {
            setExpanded(!expanded);
            if (mobileExpanded && expanded) setMobileExpanded(false);
          }}
          className="text-muted hover:text-secondary transition-colors"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>

        <Terminal size={14} className="text-primary shrink-0" />

        <input
          ref={inputRef}
          type="text"
          placeholder="Search, command, or ask anything... (\u2318K)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleMobileFocus}
          disabled={loading}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted disabled:opacity-50"
        />

        {/* Typing indicator */}
        {loading && (
          <span className="text-[10px] text-muted animate-pulse mr-1">Thinking...</span>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="text-primary hover:text-primary-hover disabled:text-muted transition-colors"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>
    </div>
  );
});
