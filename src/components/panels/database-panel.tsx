"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Database,
  ChevronRight,
  ChevronLeft,
  Plus,
  Search,
  User,
  ArrowUpDown,
  Trash2,
  X,
  Star,
  Loader2,
  Phone,
  Mail,
  ExternalLink,
  Globe,
  AtSign,
} from "lucide-react";
import type {
  Target,
  TargetType,
  TargetStatus,
  Priority,
} from "@/lib/db";

interface Props {
  collapsed: boolean;
  onExpand: () => void;
  refreshKey?: number;
  onDataChange?: () => void;
}

type SortField = "name" | "status" | "priority" | "score" | "updated_at";
type SortDir = "asc" | "desc";

const STATUS_OPTIONS: TargetStatus[] = [
  "new",
  "researched",
  "drafted",
  "deck_sent",
  "in_contact",
  "pending_intro",
  "meeting_set",
  "completed",
  "archived",
];

const PRIORITY_OPTIONS: Priority[] = ["high", "medium", "low"];
const TYPE_OPTIONS: TargetType[] = ["celebrity", "podcast", "organic"];

const ACTIVE_STATUSES: TargetStatus[] = [
  "new",
  "researched",
  "drafted",
  "deck_sent",
  "in_contact",
  "pending_intro",
  "meeting_set",
];

const CONTACTED_STATUSES: TargetStatus[] = [
  "in_contact",
  "deck_sent",
  "meeting_set",
];

// ─── Helpers ───

function typeBadgeClass(type: TargetType): string {
  switch (type) {
    case "celebrity":
      return "bg-danger/15 text-danger";
    case "podcast":
      return "bg-info/15 text-info";
    case "organic":
      return "bg-success/15 text-success";
  }
}

function statusLabel(s: TargetStatus): string {
  return s.replace(/_/g, " ");
}

function statusBadgeClass(s: TargetStatus): string {
  switch (s) {
    case "new":
      return "bg-border-light/60 text-secondary";
    case "researched":
      return "bg-info/10 text-info";
    case "drafted":
      return "bg-warning/10 text-warning";
    case "deck_sent":
      return "bg-warning/15 text-warning";
    case "in_contact":
      return "bg-primary/15 text-primary";
    case "pending_intro":
      return "bg-info/15 text-info";
    case "meeting_set":
      return "bg-success/15 text-success";
    case "completed":
      return "bg-success/20 text-success";
    case "archived":
      return "bg-border-light/40 text-muted";
  }
}

function priorityIndicator(p: Priority): string {
  switch (p) {
    case "high":
      return "text-danger";
    case "medium":
      return "text-warning";
    case "low":
      return "text-muted";
  }
}

function prioritySortValue(p: Priority): number {
  switch (p) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
  }
}

function compareFn(
  a: Target,
  b: Target,
  field: SortField,
  dir: SortDir
): number {
  let result = 0;
  switch (field) {
    case "name":
      result = a.name.localeCompare(b.name);
      break;
    case "status":
      result =
        STATUS_OPTIONS.indexOf(a.status) - STATUS_OPTIONS.indexOf(b.status);
      break;
    case "priority":
      result = prioritySortValue(a.priority) - prioritySortValue(b.priority);
      break;
    case "score":
      result = (a.score ?? -1) - (b.score ?? -1);
      break;
    case "updated_at":
      result =
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      break;
  }
  return dir === "asc" ? result : -result;
}

// ─── Main Component ───

export function DatabasePanel({ collapsed, onExpand, refreshKey, onDataChange }: Props) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchTargets = useCallback(async () => {
    try {
      const res = await fetch("/api/targets");
      if (res.ok) {
        const data: Target[] = await res.json();
        setTargets(data);
      }
    } catch {
      // silently fail — offline or no supabase
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets, refreshKey]);

  // ─── Derived data ───

  const filtered = targets
    .filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => compareFn(a, b, sortField, sortDir));

  const totalCount = targets.length;
  const activeCount = targets.filter((t) =>
    ACTIVE_STATUSES.includes(t.status)
  ).length;
  const contactedCount = targets.filter((t) =>
    CONTACTED_STATUSES.includes(t.status)
  ).length;

  // ─── Handlers ───

  async function handleQuickUpdate(
    id: string,
    updates: Partial<Target>
  ) {
    const res = await fetch("/api/targets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) {
      const updated: Target = await res.json();
      setTargets((prev) => prev.map((t) => (t.id === id ? updated : t)));
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch("/api/targets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setTargets((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) setSelectedId(null);
      setDeleteConfirmId(null);
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  }

  // ─── Collapsed view ───

  if (collapsed) {
    return (
      <button
        onClick={onExpand}
        className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted hover:text-secondary transition-colors p-2"
      >
        <div className="relative">
          <Database size={20} />
          {totalCount > 0 && (
            <span className="absolute -top-2 -right-3 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold bg-primary text-white rounded-full">
              {totalCount}
            </span>
          )}
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-lr]">
          Leads
        </span>
      </button>
    );
  }

  // ─── Detail view ───

  const selectedTarget = selectedId
    ? targets.find((t) => t.id === selectedId) ?? null
    : null;

  if (selectedTarget) {
    return (
      <div className="p-4 h-full flex flex-col">
        <button
          onClick={() => setSelectedId(null)}
          className="flex items-center gap-1 text-xs text-muted hover:text-secondary mb-4"
        >
          <ChevronLeft size={14} /> Back to list
        </button>

        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-bold">{selectedTarget.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${typeBadgeClass(selectedTarget.type)}`}
              >
                {selectedTarget.type}
              </span>
              <span
                className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${statusBadgeClass(selectedTarget.status)}`}
              >
                {statusLabel(selectedTarget.status)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Star
              size={14}
              className={priorityIndicator(selectedTarget.priority)}
              fill={
                selectedTarget.priority === "high" ? "currentColor" : "none"
              }
            />
            <span className="text-[10px] text-muted uppercase">
              {selectedTarget.priority}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Contact Info — auto-loaded from research */}
          <ContactInfoSection targetId={selectedTarget.id} />

          {/* Fields */}
          <DetailSection title="Details">
            <DetailRow label="Channel" value={selectedTarget.channel || "—"} />
            <DetailRow
              label="Score"
              value={
                selectedTarget.score !== null
                  ? String(selectedTarget.score)
                  : "—"
              }
            />
            <DetailRow
              label="Created"
              value={new Date(selectedTarget.created_at).toLocaleDateString()}
            />
            <DetailRow
              label="Updated"
              value={new Date(selectedTarget.updated_at).toLocaleDateString()}
            />
          </DetailSection>

          {/* Quick edit status/priority */}
          <DetailSection title="Quick Edit">
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="text-[10px] text-muted uppercase block mb-1">
                  Status
                </span>
                <select
                  value={selectedTarget.status}
                  onChange={(e) =>
                    handleQuickUpdate(selectedTarget.id, {
                      status: e.target.value as TargetStatus,
                    })
                  }
                  className="w-full text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1">
                <span className="text-[10px] text-muted uppercase block mb-1">
                  Priority
                </span>
                <select
                  value={selectedTarget.priority}
                  onChange={(e) =>
                    handleQuickUpdate(selectedTarget.id, {
                      priority: e.target.value as Priority,
                    })
                  }
                  className="w-full text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </DetailSection>

          {/* Notes */}
          <DetailSection title="Notes">
            <p className="text-xs text-secondary whitespace-pre-wrap">
              {selectedTarget.notes || "No notes yet."}
            </p>
          </DetailSection>
        </div>

        {/* Delete */}
        <div className="pt-3 border-t border-border mt-3">
          {deleteConfirmId === selectedTarget.id ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-danger">Delete this lead?</span>
              <button
                onClick={() => handleDelete(selectedTarget.id)}
                className="text-xs font-semibold text-white bg-danger px-3 py-1.5 rounded-lg hover:opacity-90"
              >
                Confirm
              </button>
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="text-xs text-muted hover:text-secondary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirmId(selectedTarget.id)}
              className="text-xs text-danger/70 hover:text-danger flex items-center gap-1"
            >
              <Trash2 size={12} /> Delete lead
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── List view ───

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Leads</h2>
        </div>
        <button className="text-xs text-muted hover:text-secondary flex items-center gap-1">
          View all <ChevronRight size={12} />
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <MiniStat label="Total" value={String(totalCount)} />
        <MiniStat label="Active" value={String(activeCount)} />
        <MiniStat label="Contacted" value={String(contactedCount)} />
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="text"
          placeholder="Filter leads..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-sm bg-input border border-border rounded-lg outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        <ArrowUpDown size={11} className="text-muted mr-0.5" />
        {(
          [
            ["name", "Name"],
            ["status", "Status"],
            ["priority", "Pri"],
            ["score", "Score"],
            ["updated_at", "Recent"],
          ] as [SortField, string][]
        ).map(([field, label]) => (
          <button
            key={field}
            onClick={() => toggleSort(field)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
              sortField === field
                ? "bg-primary/15 text-primary font-semibold"
                : "text-muted hover:text-secondary"
            }`}
          >
            {label}
            {sortField === field && (sortDir === "asc" ? " \u2191" : " \u2193")}
          </button>
        ))}
      </div>

      {/* Lead list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center py-8 text-muted text-sm">
            <Loader2 size={24} className="mx-auto mb-2 animate-spin opacity-50" />
            <p>Loading leads...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">
            <User size={24} className="mx-auto mb-2 opacity-50" />
            {filter ? (
              <p>No leads matching &ldquo;{filter}&rdquo;</p>
            ) : (
              <>
                <p>No leads yet</p>
                <p className="text-xs mt-1">Add targets or discover new ones</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((target) => (
              <TargetRow
                key={target.id}
                target={target}
                onSelect={() => setSelectedId(target.id)}
                onStatusChange={(status) =>
                  handleQuickUpdate(target.id, { status })
                }
                onPriorityChange={(priority) =>
                  handleQuickUpdate(target.id, { priority })
                }
                onDelete={() => {
                  if (deleteConfirmId === target.id) {
                    handleDelete(target.id);
                  } else {
                    setDeleteConfirmId(target.id);
                  }
                }}
                isDeleteConfirm={deleteConfirmId === target.id}
                onCancelDelete={() => setDeleteConfirmId(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Lead */}
      {showAddForm ? (
        <AddLeadForm
          onCreated={(t) => {
            setTargets((prev) => [t, ...prev]);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="mt-2 w-full py-2.5 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-hover transition-colors flex items-center justify-center gap-1"
        >
          <Plus size={14} /> Add Lead
        </button>
      )}
    </div>
  );
}

// ─── Sub-components ───

function TargetRow({
  target,
  onSelect,
  onStatusChange,
  onPriorityChange,
  onDelete,
  isDeleteConfirm,
  onCancelDelete,
}: {
  target: Target;
  onSelect: () => void;
  onStatusChange: (s: TargetStatus) => void;
  onPriorityChange: (p: Priority) => void;
  onDelete: () => void;
  isDeleteConfirm: boolean;
  onCancelDelete: () => void;
}) {
  return (
    <div className="group bg-card hover:bg-card/80 rounded-lg p-2.5 transition-colors">
      {/* Top row — clickable for detail */}
      <div className="flex items-center gap-2 cursor-pointer" onClick={onSelect}>
        <Star
          size={12}
          className={`shrink-0 ${priorityIndicator(target.priority)}`}
          fill={target.priority === "high" ? "currentColor" : "none"}
        />
        <span className="text-sm font-medium truncate flex-1">
          {target.name}
        </span>
        <span
          className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${typeBadgeClass(target.type)}`}
        >
          {target.type}
        </span>
        {target.score !== null && (
          <span className="text-[10px] font-bold text-warning shrink-0">
            {target.score}
          </span>
        )}
      </div>

      {/* Bottom row — inline controls */}
      <div className="flex items-center gap-1.5 mt-1.5 pl-5">
        <select
          value={target.status}
          onChange={(e) => {
            e.stopPropagation();
            onStatusChange(e.target.value as TargetStatus);
          }}
          onClick={(e) => e.stopPropagation()}
          className="text-[10px] bg-transparent border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary cursor-pointer appearance-none"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>

        <select
          value={target.priority}
          onChange={(e) => {
            e.stopPropagation();
            onPriorityChange(e.target.value as Priority);
          }}
          onClick={(e) => e.stopPropagation()}
          className="text-[10px] bg-transparent border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary cursor-pointer appearance-none"
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {isDeleteConfirm ? (
          <span className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-[10px] font-semibold text-danger hover:underline"
            >
              Confirm
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancelDelete();
              }}
              className="text-[10px] text-muted hover:text-secondary"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-opacity"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

function AddLeadForm({
  onCreated,
  onCancel,
}: {
  onCreated: (t: Target) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TargetType>("celebrity");
  const [priority, setPriority] = useState<Priority>("medium");
  const [channel, setChannel] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, priority, channel, notes }),
      });
      if (res.ok) {
        const created: Target = await res.json();
        onCreated(created);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 bg-card border border-border rounded-lg p-3 space-y-2"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider">
          New Lead
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-secondary"
        >
          <X size={14} />
        </button>
      </div>

      <input
        ref={nameRef}
        type="text"
        placeholder="Name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="w-full text-sm bg-input border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
      />

      <div className="flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TargetType)}
          className="flex-1 text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="flex-1 text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary"
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <input
        type="text"
        placeholder="Channel (e.g. Twitter, Email)"
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        className="w-full text-xs bg-input border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
      />

      <textarea
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full text-xs bg-input border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary resize-none"
      />

      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="w-full py-2 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
      >
        {submitting ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Plus size={12} />
        )}
        {submitting ? "Adding..." : "Add Lead"}
      </button>
    </form>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2 bg-card rounded-lg">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted uppercase tracking-wider">
        {label}
      </p>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="bg-card rounded-lg p-3">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// ─── Contact Info Section (auto-loads from research API) ───

interface ContactPathData {
  type: string;
  name: string;
  role: string;
  email: string | null;
  channel: string;
  confidence: string;
  source_url: string | null;
}

interface ResearchField {
  field: string;
  value: string;
}

function ContactInfoSection({ targetId }: { targetId: string }) {
  const [contactPaths, setContactPaths] = useState<ContactPathData[]>([]);
  const [researchFields, setResearchFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [quality, setQuality] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/research?targetId=${targetId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();

        if (!cancelled) {
          setContactPaths(data.contactPaths || []);
          if (typeof data.quality === "number") setQuality(data.quality);

          const fields: Record<string, string> = {};
          if (data.fields) {
            data.fields.forEach((f: ResearchField) => { fields[f.field] = f.value; });
          }
          setResearchFields(fields);
        }
      } catch {
        // No research data yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [targetId]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg p-3 text-center">
        <Loader2 size={14} className="mx-auto animate-spin text-muted" />
        <p className="text-[10px] text-muted mt-1">Loading contact info...</p>
      </div>
    );
  }

  const hasData = contactPaths.length > 0 || Object.keys(researchFields).length > 0;

  if (!hasData) {
    return (
      <div className="bg-card rounded-lg p-3">
        <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Contact Info</h3>
        <p className="text-xs text-muted">No research data yet. Research this target to find contact routes.</p>
      </div>
    );
  }

  // Extract social handles from reach field
  const reach = researchFields.reach || "";
  const igMatch = reach.match(/@([A-Za-z0-9_.]+).*?(?:instagram|IG)/i) || reach.match(/instagram[^@]*@([A-Za-z0-9_.]+)/i);
  const liMatch = reach.match(/linkedin\.com\/in\/([A-Za-z0-9-]+)/i);
  const twMatch = reach.match(/@([A-Za-z0-9_]+).*?(?:twitter|X\b)/i) || reach.match(/(?:twitter|X\b)[^@]*@([A-Za-z0-9_]+)/i);

  // Collect all emails, phones from contact paths
  const allEmails = contactPaths.filter((cp) => cp.email).map((cp) => ({ email: cp.email!, label: cp.type === "agent" ? `${cp.name} (Agent)` : cp.name }));
  const contactIntel = researchFields.contact_intel || "";
  const bestApproach = researchFields.best_approach || "";

  return (
    <div className="space-y-3">
      {/* Quality badge */}
      {quality !== null && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted uppercase tracking-wider">Research Quality</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            quality >= 75 ? "bg-success/20 text-success" :
            quality >= 50 ? "bg-warning/20 text-warning" :
            "bg-red-400/20 text-red-400"
          }`}>
            {quality}/100
          </span>
        </div>
      )}

      {/* Best Approach — highlighted */}
      {bestApproach && !bestApproach.startsWith("UNKNOWN") && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-2.5">
          <h3 className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">Best Approach</h3>
          <p className="text-xs text-foreground">{bestApproach.replace(/\s*\[SOURCE:.*?\]/g, "")}</p>
        </div>
      )}

      {/* Contact Routes */}
      {contactPaths.length > 0 && (
        <DetailSection title={`Contact Routes (${contactPaths.length})`}>
          <div className="space-y-2.5">
            {contactPaths.map((cp, i) => (
              <div key={i} className="border-b border-border last:border-0 pb-2 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {cp.type === "direct" ? "Direct" : cp.type === "agent" ? "Agent / Rep" : "Wildcard"}
                  </span>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    cp.confidence === "high" ? "bg-success/20 text-success" :
                    cp.confidence === "medium" ? "bg-warning/20 text-warning" :
                    "bg-muted/20 text-muted"
                  }`}>
                    {cp.confidence}
                  </span>
                </div>
                <p className="text-xs font-medium">{cp.name}</p>
                {cp.role && <p className="text-[10px] text-muted">{cp.role}</p>}

                <div className="flex flex-wrap gap-2 mt-1.5">
                  {cp.email && (
                    <a href={`mailto:${cp.email}`} className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                      <Mail size={10} /> {cp.email}
                    </a>
                  )}
                  {cp.channel === "instagram" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                      <AtSign size={10} /> {cp.channel}
                    </span>
                  )}
                  {cp.channel === "linkedin" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                      <Globe size={10} /> {cp.channel}
                    </span>
                  )}
                  {cp.channel === "phone" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                      <Phone size={10} /> {cp.channel}
                    </span>
                  )}
                  {cp.source_url && (
                    <a href={cp.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[9px] text-primary/60 hover:underline">
                      <ExternalLink size={8} /> source
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {/* Quick contact summary — emails + social */}
      <DetailSection title="Contact Summary">
        {allEmails.length > 0 && (
          <div className="space-y-1 mb-2">
            {allEmails.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Mail size={10} className="text-muted shrink-0" />
                <a href={`mailto:${e.email}`} className="text-primary hover:underline truncate">{e.email}</a>
                <span className="text-[9px] text-muted shrink-0">{e.label}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {igMatch && (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <AtSign size={12} /> @{igMatch[1]}
            </span>
          )}
          {liMatch && (
            <a href={`https://linkedin.com/in/${liMatch[1]}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Globe size={12} /> {liMatch[1]}
            </a>
          )}
          {twMatch && (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <span className="font-bold text-[10px]">𝕏</span> @{twMatch[1]}
            </span>
          )}
        </div>
        {allEmails.length === 0 && !igMatch && !liMatch && !twMatch && (
          <p className="text-xs text-muted">No contact details found yet.</p>
        )}
      </DetailSection>

      {/* Contact intel summary */}
      {contactIntel && !contactIntel.startsWith("UNKNOWN") && (
        <DetailSection title="Contact Intel">
          <p className="text-xs text-secondary whitespace-pre-wrap">{contactIntel.replace(/\s*\[SOURCE:.*?\]/g, "")}</p>
        </DetailSection>
      )}
    </div>
  );
}
