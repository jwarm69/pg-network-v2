import { NextResponse } from "next/server";
import { isDbConfigured, getMessageById } from "@/lib/db";
import { getAdapter } from "@/lib/send-adapter";

export const dynamic = "force-dynamic";

// ─── GET: adapter status ───

export async function GET() {
  const adapter = getAdapter();
  return NextResponse.json({
    adapter: adapter.name,
    connected: adapter.name !== "noop",
  });
}

// ─── POST: create_draft | sync_inbox ───

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body;

  if (action === "create_draft") {
    return handleCreateDraft(body);
  }

  if (action === "sync_inbox") {
    return handleSyncInbox();
  }

  return NextResponse.json(
    { error: `Unknown action: ${String(action)}` },
    { status: 400 }
  );
}

// ─── Handlers ───

async function handleCreateDraft(body: Record<string, unknown>) {
  const messageId = body.messageId as string | undefined;
  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const message = await getMessageById(messageId);

  if (!message) {
    return NextResponse.json(
      { error: "Message not found" },
      { status: 404 }
    );
  }

  const adapter = getAdapter();

  try {
    const result = await adapter.createDraft(
      "",
      message.subject || "",
      message.body || ""
    );
    return NextResponse.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

async function handleSyncInbox() {
  const adapter = getAdapter();

  try {
    const result = await adapter.syncInbox("Performance Golf");
    return NextResponse.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { messages: [], error: errorMessage },
      { status: 500 }
    );
  }
}
