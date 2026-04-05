import { NextResponse } from "next/server";
import { isDbConfigured, getMessageById } from "@/lib/db";
import {
  isGoogleConfigured,
  isGmailConnected,
  createGmailDraft,
  sendGmailDraft,
  checkForReplies,
} from "@/lib/google-auth";

export const dynamic = "force-dynamic";

// ─── GET: Gmail connection status ───

export async function GET() {
  const configured = isGoogleConfigured();
  let connected = false;

  if (configured) {
    try {
      connected = await isGmailConnected();
    } catch {
      connected = false;
    }
  }

  return NextResponse.json({
    configured,
    connected,
    connectUrl: configured && !connected ? "/api/auth/google" : null,
  });
}

// ─── POST: create_draft | send_draft | check_replies ───

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body;

  if (action === "create_draft") return handleCreateDraft(body);
  if (action === "send_draft") return handleSendDraft(body);
  if (action === "check_replies") return handleCheckReplies(body);

  return NextResponse.json({ error: `Unknown action: ${String(action)}` }, { status: 400 });
}

// ─── Create Draft ───

async function handleCreateDraft(body: Record<string, unknown>) {
  const messageId = body.messageId as string | undefined;
  const directTo = body.to as string | undefined;
  const directSubject = body.subject as string | undefined;
  const directBody = body.body as string | undefined;

  let to = directTo || "";
  let subject = directSubject || "";
  let emailBody = directBody || "";

  if (messageId) {
    if (!isDbConfigured()) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }
    const message = await getMessageById(messageId);
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    subject = subject || message.subject || "";
    emailBody = emailBody || message.body || "";
  }

  if (!emailBody) {
    return NextResponse.json({ error: "No email body provided" }, { status: 400 });
  }

  const connected = await isGmailConnected();

  if (!connected) {
    return NextResponse.json({
      success: true,
      mode: "local",
      note: "Gmail not connected. Draft saved locally only. Connect Gmail to create real drafts.",
    });
  }

  try {
    const result = await createGmailDraft(to, subject, emailBody);
    return NextResponse.json({
      success: true,
      mode: "gmail",
      draftId: result.draftId,
      threadId: result.threadId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

// ─── Send Draft ───

async function handleSendDraft(body: Record<string, unknown>) {
  const draftId = body.draftId as string | undefined;
  if (!draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  const connected = await isGmailConnected();
  if (!connected) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 503 });
  }

  try {
    const result = await sendGmailDraft(draftId);
    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

// ─── Check Replies ───

async function handleCheckReplies(body: Record<string, unknown>) {
  const threadId = body.threadId as string | undefined;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }

  const connected = await isGmailConnected();
  if (!connected) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 503 });
  }

  try {
    const result = await checkForReplies(threadId);
    return NextResponse.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ hasReply: false, error: errorMessage }, { status: 500 });
  }
}
