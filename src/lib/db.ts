import { createClient, type Client, type InValue } from "@libsql/client";

// ─── Client ───

let _client: Client | null = null;
let _schemaInitialized = false;

function getClient(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("TURSO_DATABASE_URL is not set");
    }

    _client = createClient({ url, authToken: authToken || undefined });
  }
  return _client;
}

export function isDbConfigured(): boolean {
  return !!process.env.TURSO_DATABASE_URL;
}

async function ensureSchema(): Promise<void> {
  if (_schemaInitialized) return;
  const db = getClient();

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS targets (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'new',
      priority   TEXT NOT NULL DEFAULT 'medium',
      channel    TEXT NOT NULL DEFAULT '',
      score      REAL,
      notes      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      target_id  TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      field      TEXT NOT NULL,
      value      TEXT NOT NULL,
      source_url TEXT,
      verified   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outreach_threads (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      target_id       TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      lane            TEXT NOT NULL,
      channel         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'draft',
      recipient_name  TEXT,
      recipient_email TEXT,
      gmail_thread_id TEXT,
      gmail_draft_id  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      thread_id          TEXT NOT NULL REFERENCES outreach_threads(id) ON DELETE CASCADE,
      sequence           INTEGER NOT NULL,
      subject            TEXT NOT NULL,
      body               TEXT NOT NULL,
      sent               INTEGER NOT NULL DEFAULT 0,
      sent_at            TEXT,
      response_text      TEXT,
      response_sentiment TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_paths (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      target_id  TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      name       TEXT NOT NULL,
      role       TEXT NOT NULL,
      email      TEXT,
      channel    TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium',
      source_url TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      target_id  TEXT REFERENCES targets(id) ON DELETE SET NULL,
      action     TEXT NOT NULL,
      details    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS command_history (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      input      TEXT NOT NULL,
      response   TEXT NOT NULL,
      intent     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_targets_status ON targets(status);
    CREATE INDEX IF NOT EXISTS idx_targets_type ON targets(type);
    CREATE INDEX IF NOT EXISTS idx_targets_priority ON targets(priority);
    CREATE INDEX IF NOT EXISTS idx_research_target_id ON research(target_id);
    CREATE INDEX IF NOT EXISTS idx_outreach_threads_target_id ON outreach_threads(target_id);
    CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_target_id ON activity_log(target_id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
  `);

  _schemaInitialized = true;
}

// ─── Types ───

export type TargetType = "celebrity" | "podcast" | "organic";
export type TargetStatus =
  | "new"
  | "researched"
  | "drafted"
  | "deck_sent"
  | "in_contact"
  | "pending_intro"
  | "meeting_set"
  | "completed"
  | "archived";
export type Priority = "high" | "medium" | "low";
export type Lane = "direct" | "agent" | "wildcard";
export type ThreadStatus = "draft" | "ready_for_review" | "approved" | "active" | "paused" | "completed";
export type Sentiment = "interested" | "warm" | "redirect" | "neutral" | "decline" | "spam";

export interface Target {
  id: string;
  name: string;
  type: TargetType;
  status: TargetStatus;
  priority: Priority;
  channel: string;
  score: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Research {
  id: string;
  target_id: string;
  field: string;
  value: string;
  source_url: string | null;
  verified: boolean;
  created_at: string;
}

export interface OutreachThread {
  id: string;
  target_id: string;
  lane: Lane;
  channel: string;
  status: ThreadStatus;
  recipient_name: string | null;
  recipient_email: string | null;
  gmail_thread_id: string | null;
  gmail_draft_id: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  sequence: number;
  subject: string;
  body: string;
  sent: boolean;
  sent_at: string | null;
  response_text: string | null;
  response_sentiment: Sentiment | null;
  created_at: string;
}

export interface ContactPath {
  id: string;
  target_id: string;
  type: string;
  name: string;
  role: string;
  email: string | null;
  channel: string;
  confidence: "high" | "medium" | "low";
  source_url: string | null;
}

export interface ActivityEntry {
  id: string;
  target_id: string | null;
  action: string;
  details: string;
  created_at: string;
}

export interface CommandEntry {
  id: string;
  input: string;
  response: string;
  intent: string | null;
  created_at: string;
}

// ─── Row helpers ───

function rowToTarget(row: Record<string, unknown>): Target {
  return row as unknown as Target;
}

function rowToResearch(row: Record<string, unknown>): Research {
  return { ...row, verified: !!row.verified } as unknown as Research;
}

function rowToMessage(row: Record<string, unknown>): Message {
  return { ...row, sent: !!row.sent } as unknown as Message;
}

// ─── Queries ───

export async function getTargets(): Promise<Target[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute("SELECT * FROM targets ORDER BY updated_at DESC");
  return result.rows.map((r) => rowToTarget(r as unknown as Record<string, unknown>));
}

export async function getTarget(id: string): Promise<Target | null> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({ sql: "SELECT * FROM targets WHERE id = ?", args: [id] });
  if (result.rows.length === 0) return null;
  return rowToTarget(result.rows[0] as unknown as Record<string, unknown>);
}

export async function createTarget(target: Omit<Target, "id" | "created_at" | "updated_at">): Promise<Target> {
  await ensureSchema();
  const db = getClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO targets (id, name, type, status, priority, channel, score, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, target.name, target.type, target.status, target.priority, target.channel, target.score, target.notes, now, now],
  });
  const result = await db.execute({ sql: "SELECT * FROM targets WHERE id = ?", args: [id] });
  return rowToTarget(result.rows[0] as unknown as Record<string, unknown>);
}

export async function updateTarget(id: string, updates: Partial<Target>): Promise<Target> {
  await ensureSchema();
  const db = getClient();
  const now = new Date().toISOString();

  const fields: string[] = [];
  const values: InValue[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "id" || key === "created_at") continue;
    fields.push(`${key} = ?`);
    values.push(value as InValue);
  }

  fields.push("updated_at = ?");
  values.push(now);
  values.push(id);

  await db.execute({
    sql: `UPDATE targets SET ${fields.join(", ")} WHERE id = ?`,
    args: values,
  });

  const result = await db.execute({ sql: "SELECT * FROM targets WHERE id = ?", args: [id] });
  return rowToTarget(result.rows[0] as unknown as Record<string, unknown>);
}

export async function deleteTarget(id: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({ sql: "DELETE FROM targets WHERE id = ?", args: [id] });
}

export async function getResearch(targetId: string): Promise<Research[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM research WHERE target_id = ? ORDER BY created_at ASC",
    args: [targetId],
  });
  return result.rows.map((r) => rowToResearch(r as unknown as Record<string, unknown>));
}

export async function deleteResearch(targetId: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({ sql: "DELETE FROM research WHERE target_id = ?", args: [targetId] });
}

export async function insertResearchRows(targetId: string, fields: { field: string; value: string; verified?: boolean }[]): Promise<void> {
  await ensureSchema();
  const db = getClient();
  for (const f of fields) {
    await db.execute({
      sql: "INSERT INTO research (id, target_id, field, value, verified) VALUES (?, ?, ?, ?, ?)",
      args: [crypto.randomUUID(), targetId, f.field, f.value, f.verified ? 1 : 0],
    });
  }
}

export async function getThreads(targetId: string): Promise<OutreachThread[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM outreach_threads WHERE target_id = ? ORDER BY created_at ASC",
    args: [targetId],
  });
  return result.rows as unknown as OutreachThread[];
}

export async function createThread(thread: { target_id: string; lane: string; channel: string; status?: string; recipient_name?: string | null; recipient_email?: string | null }): Promise<OutreachThread> {
  await ensureSchema();
  const db = getClient();
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO outreach_threads (id, target_id, lane, channel, status, recipient_name, recipient_email) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, thread.target_id, thread.lane, thread.channel, thread.status || "draft", thread.recipient_name || null, thread.recipient_email || null],
  });
  const result = await db.execute({ sql: "SELECT * FROM outreach_threads WHERE id = ?", args: [id] });
  return result.rows[0] as unknown as OutreachThread;
}

export async function getMessages(threadId: string): Promise<Message[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM messages WHERE thread_id = ? ORDER BY sequence ASC",
    args: [threadId],
  });
  return result.rows.map((r) => rowToMessage(r as unknown as Record<string, unknown>));
}

export async function insertMessages(messages: { thread_id: string; sequence: number; subject: string; body: string; sent?: boolean }[]): Promise<Message[]> {
  await ensureSchema();
  const db = getClient();
  const ids: string[] = [];
  for (const msg of messages) {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.execute({
      sql: "INSERT INTO messages (id, thread_id, sequence, subject, body, sent) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, msg.thread_id, msg.sequence, msg.subject, msg.body, msg.sent ? 1 : 0],
    });
  }
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.execute({
    sql: `SELECT * FROM messages WHERE id IN (${placeholders}) ORDER BY sequence ASC`,
    args: ids,
  });
  return result.rows.map((r) => rowToMessage(r as unknown as Record<string, unknown>));
}

export async function updateMessage(id: string, updates: Partial<Message>): Promise<Message> {
  await ensureSchema();
  const db = getClient();
  const fields: string[] = [];
  const values: InValue[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "id" || key === "created_at") continue;
    fields.push(`${key} = ?`);
    values.push(key === "sent" ? (value ? 1 : 0) : value as InValue);
  }
  values.push(id);

  await db.execute({
    sql: `UPDATE messages SET ${fields.join(", ")} WHERE id = ?`,
    args: values,
  });

  const result = await db.execute({ sql: "SELECT * FROM messages WHERE id = ?", args: [id] });
  return rowToMessage(result.rows[0] as unknown as Record<string, unknown>);
}

export async function updateThread(id: string, updates: Partial<OutreachThread>): Promise<OutreachThread> {
  await ensureSchema();
  const db = getClient();
  const fields: string[] = [];
  const values: InValue[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "id" || key === "created_at") continue;
    fields.push(`${key} = ?`);
    values.push(value as InValue);
  }
  values.push(id);

  await db.execute({
    sql: `UPDATE outreach_threads SET ${fields.join(", ")} WHERE id = ?`,
    args: values,
  });

  const result = await db.execute({ sql: "SELECT * FROM outreach_threads WHERE id = ?", args: [id] });
  return result.rows[0] as unknown as OutreachThread;
}

export async function getAllThreadsWithTargets(): Promise<Array<OutreachThread & { targets: Partial<Target> | null; messages: Message[] }>> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute(
    `SELECT ot.*, t.id as t_id, t.name as t_name, t.type as t_type, t.status as t_status, t.priority as t_priority, t.score as t_score
     FROM outreach_threads ot
     LEFT JOIN targets t ON ot.target_id = t.id
     ORDER BY ot.created_at DESC`
  );

  const threads: Array<OutreachThread & { targets: Partial<Target> | null; messages: Message[] }> = [];

  for (const row of result.rows) {
    const r = row as unknown as Record<string, unknown>;
    const thread: OutreachThread = {
      id: r.id as string,
      target_id: r.target_id as string,
      lane: r.lane as Lane,
      channel: r.channel as string,
      status: r.status as ThreadStatus,
      recipient_name: (r.recipient_name as string) || null,
      recipient_email: (r.recipient_email as string) || null,
      gmail_thread_id: (r.gmail_thread_id as string) || null,
      gmail_draft_id: (r.gmail_draft_id as string) || null,
      created_at: r.created_at as string,
    };

    const target = r.t_id
      ? { id: r.t_id as string, name: r.t_name as string, type: r.t_type as string, status: r.t_status as string, priority: r.t_priority as string, score: r.t_score as number | null }
      : null;

    const messages = await getMessages(thread.id);

    threads.push({ ...thread, targets: target as Partial<Target> | null, messages });
  }

  return threads;
}

export async function getContactPaths(targetId: string): Promise<ContactPath[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM contact_paths WHERE target_id = ?",
    args: [targetId],
  });
  return result.rows as unknown as ContactPath[];
}

export async function deleteContactPaths(targetId: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({ sql: "DELETE FROM contact_paths WHERE target_id = ?", args: [targetId] });
}

export async function insertContactPaths(
  targetId: string,
  paths: Omit<ContactPath, "id" | "target_id">[]
): Promise<void> {
  await ensureSchema();
  const db = getClient();
  for (const p of paths) {
    await db.execute({
      sql: `INSERT INTO contact_paths (id, target_id, type, name, role, email, channel, confidence, source_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(), targetId, p.type, p.name, p.role,
        p.email, p.channel, p.confidence, p.source_url,
      ],
    });
  }
}

export async function getActivity(limit = 50, targetId?: string): Promise<ActivityEntry[]> {
  await ensureSchema();
  const db = getClient();

  if (targetId) {
    const result = await db.execute({
      sql: "SELECT * FROM activity_log WHERE target_id = ? ORDER BY created_at DESC LIMIT ?",
      args: [targetId, limit],
    });
    return result.rows as unknown as ActivityEntry[];
  }

  const result = await db.execute({
    sql: "SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  });
  return result.rows as unknown as ActivityEntry[];
}

export async function logActivity(entry: Omit<ActivityEntry, "id" | "created_at">): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: "INSERT INTO activity_log (id, target_id, action, details) VALUES (?, ?, ?, ?)",
    args: [crypto.randomUUID(), entry.target_id, entry.action, entry.details],
  });
}

export async function getCommandHistory(limit = 20): Promise<CommandEntry[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM command_history ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  });
  return result.rows as unknown as CommandEntry[];
}

export async function saveCommandEntry(input: string, response: string, intent: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: "INSERT INTO command_history (id, input, response, intent) VALUES (?, ?, ?, ?)",
    args: [crypto.randomUUID(), input, response, intent],
  });
}

export async function getMessageById(id: string): Promise<Message | null> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({ sql: "SELECT * FROM messages WHERE id = ?", args: [id] });
  if (result.rows.length === 0) return null;
  return rowToMessage(result.rows[0] as unknown as Record<string, unknown>);
}

// ─── Gmail-tracked threads ───

export async function getGmailTrackedThreads(): Promise<Array<OutreachThread & { target_name: string }>> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute(
    `SELECT ot.*, t.name as target_name
     FROM outreach_threads ot
     JOIN targets t ON ot.target_id = t.id
     WHERE ot.gmail_thread_id IS NOT NULL
       AND ot.status IN ('active', 'approved', 'draft')
     ORDER BY ot.created_at DESC`
  );
  return result.rows as unknown as Array<OutreachThread & { target_name: string }>;
}

// ─── Settings (key-value store) ───

export async function getSetting(key: string): Promise<string | null> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  if (result.rows.length === 0) return null;
  return (result.rows[0] as unknown as { value: string }).value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    args: [key, value, value],
  });
}
