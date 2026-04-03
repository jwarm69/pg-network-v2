import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
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

// ─── Queries ───

export async function getTargets(): Promise<Target[]> {
  const { data, error } = await supabase
    .from("targets")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getTarget(id: string): Promise<Target | null> {
  const { data, error } = await supabase
    .from("targets")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function createTarget(target: Omit<Target, "id" | "created_at" | "updated_at">): Promise<Target> {
  const { data, error } = await supabase
    .from("targets")
    .insert(target)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTarget(id: string, updates: Partial<Target>): Promise<Target> {
  const { data, error } = await supabase
    .from("targets")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getResearch(targetId: string): Promise<Research[]> {
  const { data, error } = await supabase
    .from("research")
    .select("*")
    .eq("target_id", targetId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getThreads(targetId: string): Promise<OutreachThread[]> {
  const { data, error } = await supabase
    .from("outreach_threads")
    .select("*")
    .eq("target_id", targetId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getMessages(threadId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("sequence", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getContactPaths(targetId: string): Promise<ContactPath[]> {
  const { data, error } = await supabase
    .from("contact_paths")
    .select("*")
    .eq("target_id", targetId);
  if (error) throw error;
  return data || [];
}

export async function getActivity(limit = 50): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function logActivity(entry: Omit<ActivityEntry, "id" | "created_at">): Promise<void> {
  await supabase.from("activity_log").insert(entry);
}

export async function getCommandHistory(limit = 20): Promise<CommandEntry[]> {
  const { data, error } = await supabase
    .from("command_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
