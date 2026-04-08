import { NextResponse } from "next/server";
import {
  getGmailTrackedThreads,
  updateThread,
  updateTarget,
  logActivity,
} from "@/lib/db";
import { checkForReplies } from "@/lib/google-auth";
import { isGmailConnected } from "@/lib/google-auth";
import { getAgentRunsByStatus, getSignalCountSince } from "@/lib/db-agent";
import { executeNextStep, triggerContinuation } from "@/lib/agent/loop";
import { checkExpiredGates } from "@/lib/agent/gates";
import { signalReplyReceived } from "@/lib/agent/signals";
import { runAdaptation } from "@/lib/agent/adaptation";
import { askClaude } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Validate cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results: Record<string, unknown> = {};

  // 1. Check Gmail replies (existing functionality)
  try {
    const connected = await isGmailConnected();
    if (connected) {
      const threads = await getGmailTrackedThreads();
      let replyCount = 0;

      for (const thread of threads) {
        if (!thread.gmail_thread_id) continue;
        try {
          const reply = await checkForReplies(thread.gmail_thread_id);
          if (reply.hasReply) {
            replyCount++;
            await updateThread(thread.id, { status: "completed" });
            await updateTarget(thread.target_id, { status: "in_contact" });

            // Classify sentiment
            let sentiment = "neutral";
            if (reply.replyText && process.env.ANTHROPIC_API_KEY) {
              try {
                sentiment = await askClaude(
                  `Classify the sentiment of this reply to a networking outreach email. Reply: "${reply.replyText.slice(0, 500)}"\n\nClassify as one of: interested, warm, redirect, neutral, decline, spam. Respond with just the word.`,
                  { system: "Classify email sentiment. Respond with a single word.", maxTokens: 10, temperature: 0 }
                );
                sentiment = sentiment.trim().toLowerCase();
              } catch { /* use default */ }
            }

            await logActivity({
              target_id: thread.target_id,
              action: "reply_received",
              details: `Reply from ${reply.replyFrom}: ${(reply.replyText || "").slice(0, 200)}. Sentiment: ${sentiment}`,
            });

            // Emit learning signal
            await signalReplyReceived({
              targetId: thread.target_id,
              threadId: thread.id,
              replyText: reply.replyText || "",
              replyFrom: reply.replyFrom || "",
              sentiment,
            });
          }
        } catch { /* skip individual thread errors */ }
      }

      results.replies = { checked: threads.length, found: replyCount };
    }
  } catch (err) {
    results.replies = { error: err instanceof Error ? err.message : "Unknown" };
  }

  // 2. Pick up stalled agent runs
  try {
    const stalledRuns = await getAgentRunsByStatus("executing");
    let resumed = 0;
    for (const run of stalledRuns) {
      // Only resume runs that have been stalled for > 2 minutes
      const runAge = Date.now() - new Date(run.started_at || run.created_at).getTime();
      if (runAge > 2 * 60 * 1000) {
        try {
          const result = await executeNextStep(run.id);
          if (result.status === "executing") {
            triggerContinuation(run.id).catch(() => {});
          }
          resumed++;
        } catch { /* skip */ }
      }
    }
    results.stalledRuns = { found: stalledRuns.length, resumed };
  } catch (err) {
    results.stalledRuns = { error: err instanceof Error ? err.message : "Unknown" };
  }

  // 3. Check expired approval gates
  try {
    const expired = await checkExpiredGates();
    results.expiredGates = { count: expired };
  } catch (err) {
    results.expiredGates = { error: err instanceof Error ? err.message : "Unknown" };
  }

  // 4. Run adaptation only if there are new signals since last run
  try {
    // Only re-run adaptation if 5+ signals arrived in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const newSignalCount = await getSignalCountSince(oneHourAgo);
    if (newSignalCount >= 5) {
      await runAdaptation();
      results.adaptation = { ran: true, newSignalCount };
    } else {
      results.adaptation = { ran: false, newSignalCount, reason: "fewer than 5 new signals in the last hour" };
    }
  } catch (err) {
    results.adaptation = { error: err instanceof Error ? err.message : "Unknown" };
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    results,
  });
}
