import { supabase, isSupabaseConfigured } from "./supabase";

export interface InboxMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
}

export interface DraftResult {
  success: boolean;
  draftId?: string;
  error?: string;
}

export interface InboxResult {
  messages: InboxMessage[];
}

export interface SendAdapter {
  readonly name: string;
  createDraft(to: string, subject: string, body: string): Promise<DraftResult>;
  syncInbox(query: string): Promise<InboxResult>;
}

export class NoopAdapter implements SendAdapter {
  readonly name = "noop";

  async createDraft(to: string, subject: string, body: string): Promise<DraftResult> {
    if (isSupabaseConfigured()) {
      await supabase.from("activity_log").insert({
        action: "draft_created",
        details: JSON.stringify({ to, subject, bodyLength: body.length }),
      });
    }
    return { success: true };
  }

  async syncInbox(_query: string): Promise<InboxResult> {
    return { messages: [] };
  }
}

export class PlaywrightAdapter implements SendAdapter {
  readonly name = "playwright";

  async createDraft(_to: string, _subject: string, _body: string): Promise<DraftResult> {
    throw new Error("Not implemented \u2014 connect Playwright or Claude Connectors");
  }

  async syncInbox(_query: string): Promise<InboxResult> {
    throw new Error("Not implemented \u2014 connect Playwright or Claude Connectors");
  }
}

let currentAdapter: SendAdapter | null = null;

export function getAdapter(): SendAdapter {
  if (!currentAdapter) {
    currentAdapter = new NoopAdapter();
  }
  return currentAdapter;
}

export function setAdapter(adapter: SendAdapter): void {
  currentAdapter = adapter;
}
