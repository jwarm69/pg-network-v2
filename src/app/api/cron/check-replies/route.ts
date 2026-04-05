import { NextResponse } from "next/server";
import {
  isDbConfigured,
  getGmailTrackedThreads,
  updateThread,
  updateTarget,
  logActivity,
} from "@/lib/db";
import { isGmailConnected, checkForReplies } from "@/lib/google-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel cron calls this every 15 minutes.
// Protected by CRON_SECRET to prevent external abuse.

export async function GET(request: Request) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ skipped: true, reason: "DB not configured" });
  }

  const connected = await isGmailConnected();
  if (!connected) {
    return NextResponse.json({ skipped: true, reason: "Gmail not connected" });
  }

  try {
    const threads = await getGmailTrackedThreads();

    if (threads.length === 0) {
      return NextResponse.json({ checked: 0, replies: 0 });
    }

    let repliesFound = 0;
    const results: Array<{ threadId: string; targetName: string; hasReply: boolean; replyFrom?: string }> = [];

    for (const thread of threads) {
      if (!thread.gmail_thread_id) continue;

      try {
        const reply = await checkForReplies(thread.gmail_thread_id);

        results.push({
          threadId: thread.id,
          targetName: thread.target_name,
          hasReply: reply.hasReply,
          replyFrom: reply.replyFrom,
        });

        if (reply.hasReply) {
          repliesFound++;

          // Update thread status
          await updateThread(thread.id, { status: "completed" } as Partial<import("@/lib/db").OutreachThread>);

          // Update target status to in_contact
          await updateTarget(thread.target_id, { status: "in_contact" } as Partial<import("@/lib/db").Target>);

          // Log activity
          await logActivity({
            target_id: thread.target_id,
            action: "reply_received",
            details: `Reply detected from ${reply.replyFrom || "unknown"} on ${thread.lane} lane. Preview: ${(reply.replyText || "").slice(0, 100)}`,
          });

          console.log(`Reply found for ${thread.target_name} from ${reply.replyFrom}`);
        }
      } catch (err) {
        console.error(`Error checking replies for thread ${thread.id}:`, err);
      }
    }

    return NextResponse.json({
      checked: threads.length,
      replies: repliesFound,
      results,
    });
  } catch (err) {
    console.error("Cron check-replies error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
