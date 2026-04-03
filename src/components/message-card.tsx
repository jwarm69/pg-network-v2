"use client";

import { useState, useCallback } from "react";
import {
  Edit3,
  Check,
  Copy,
  Send,
  Mail,
  AlertTriangle,
  X,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { validateMessage, type Violation } from "@/lib/validate";
import type { Message } from "@/lib/supabase";

// ─── Props ───

interface MessageCardProps {
  message: Message;
  laneColor: string; // tailwind color class, e.g. "bg-primary", "bg-info", "bg-warning"
  onEdit?: (id: string, updates: { subject: string; body: string }) => void;
  onApprove?: (id: string) => void;
  onMarkSent?: (id: string) => void;
  onCopy?: (id: string) => void;
  onCreateDraft?: (id: string) => void;
}

// ─── Sequence label ───

function sequenceLabel(seq: number): string {
  return `M${seq}`;
}

// ─── Component ───

export function MessageCard({
  message,
  laneColor,
  onEdit,
  onApprove,
  onMarkSent,
  onCopy,
  onCreateDraft,
}: MessageCardProps) {
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(message.subject);
  const [editBody, setEditBody] = useState(message.body);
  const [copied, setCopied] = useState(false);

  // Validation
  const validation = validateMessage(message.body);
  const violations: Violation[] = validation.violations;

  // ─── Actions ───

  const handleSave = useCallback(() => {
    onEdit?.(message.id, { subject: editSubject, body: editBody });
    setEditing(false);
  }, [message.id, editSubject, editBody, onEdit]);

  const handleCancel = useCallback(() => {
    setEditSubject(message.subject);
    setEditBody(message.body);
    setEditing(false);
  }, [message.subject, message.body]);

  const handleCopy = useCallback(async () => {
    try {
      const text = message.subject
        ? `Subject: ${message.subject}\n\n${message.body}`
        : message.body;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy?.(message.id);
    } catch {
      // Clipboard API may not be available
    }
  }, [message, onCopy]);

  // ─── Render ───

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-input/50">
        {/* Lane color dot */}
        <span className={cn("w-2 h-2 rounded-full shrink-0", laneColor)} />

        {/* Sequence badge */}
        <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">
          {sequenceLabel(message.sequence)}
        </span>

        {/* Sent badge */}
        {message.sent ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-success">
            <Check size={12} />
            Sent{message.sent_at ? ` ${new Date(message.sent_at).toLocaleDateString()}` : ""}
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-muted">Draft</span>
        )}
      </div>

      {/* Validation warnings */}
      {violations.length > 0 && (
        <div className="px-3 py-1.5 bg-warning/5 border-b border-warning/10 flex flex-wrap gap-1.5">
          {violations.map((v, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded"
            >
              <AlertTriangle size={10} />
              {v.detail}
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="p-3">
        {editing ? (
          /* ─── Edit mode ─── */
          <div className="space-y-2">
            <input
              type="text"
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              placeholder="Subject..."
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary/50"
            />
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={6}
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary/50 resize-y"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-primary text-white hover:bg-primary-hover transition-colors"
              >
                <Check size={12} /> Save
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          /* ─── Display mode ─── */
          <div>
            {message.subject && (
              <p className="text-xs font-semibold text-foreground mb-1">
                {message.subject}
              </p>
            )}
            <p className="text-sm text-secondary whitespace-pre-wrap leading-relaxed">
              {message.body}
            </p>
          </div>
        )}
      </div>

      {/* Response bubble */}
      {message.response_text && (
        <div className="px-3 pb-3">
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-success/5 border border-success/10">
            <MessageSquare size={14} className="text-success mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold text-success uppercase tracking-wider mb-0.5">
                Response
                {message.response_sentiment && (
                  <span className="ml-1.5 text-secondary font-normal normal-case">
                    ({message.response_sentiment})
                  </span>
                )}
              </p>
              <p className="text-xs text-secondary whitespace-pre-wrap">
                {message.response_text}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons (hidden when editing or sent) */}
      {!editing && !message.sent && (
        <div className="flex items-center gap-1 px-3 py-2 border-t border-border">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-muted hover:text-foreground hover:bg-input transition-colors"
          >
            <Edit3 size={12} /> Edit
          </button>
          <button
            onClick={() => onApprove?.(message.id)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-muted hover:text-success hover:bg-success/5 transition-colors"
          >
            <Check size={12} /> Approve
          </button>
          <button
            onClick={() => onMarkSent?.(message.id)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-muted hover:text-info hover:bg-info/5 transition-colors"
          >
            <Send size={12} /> Mark Sent
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-muted hover:text-foreground hover:bg-input transition-colors"
          >
            <Copy size={12} /> {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={() => onCreateDraft?.(message.id)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-muted hover:text-primary hover:bg-primary/5 transition-colors"
          >
            <Mail size={12} /> Gmail Draft
          </button>
        </div>
      )}
    </div>
  );
}
