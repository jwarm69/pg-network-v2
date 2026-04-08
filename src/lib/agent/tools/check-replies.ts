import { registerTool } from "../registry";
import { getGmailTrackedThreads, updateThread, updateTarget, logActivity } from "../../db";
import { checkForReplies } from "../../google-auth";
import type { ToolResult } from "../types";

interface CheckRepliesInput {
  threadId?: string;
}

interface ReplyResult {
  threadId: string;
  targetName: string;
  hasReply: boolean;
  replyText?: string;
  replyFrom?: string;
}

interface CheckRepliesOutput {
  checked: number;
  replies: number;
  results: ReplyResult[];
}

registerTool<CheckRepliesInput, CheckRepliesOutput>({
  name: "check_replies",
  description: "Check Gmail threads for new replies. If no threadId specified, checks all active tracked threads.",
  category: "gmail",
  permissions: ["read"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      threadId: { type: "string", description: "Specific thread ID to check (optional)" },
    },
  },
  async execute(input): Promise<ToolResult<CheckRepliesOutput>> {
    const threads = await getGmailTrackedThreads();
    const toCheck = input.threadId
      ? threads.filter((t) => t.id === input.threadId)
      : threads;

    const results: ReplyResult[] = [];
    let replyCount = 0;

    for (const thread of toCheck) {
      if (!thread.gmail_thread_id) continue;

      try {
        const reply = await checkForReplies(thread.gmail_thread_id);
        const result: ReplyResult = {
          threadId: thread.id,
          targetName: thread.target_name,
          hasReply: reply.hasReply,
          replyText: reply.replyText,
          replyFrom: reply.replyFrom,
        };

        if (reply.hasReply) {
          replyCount++;
          await updateThread(thread.id, { status: "completed" });
          await updateTarget(thread.target_id, { status: "in_contact" });
          await logActivity({
            target_id: thread.target_id,
            action: "reply_received",
            details: `Reply from ${reply.replyFrom}: ${(reply.replyText || "").slice(0, 200)}`,
          });
        }

        results.push(result);
      } catch {
        results.push({
          threadId: thread.id,
          targetName: thread.target_name,
          hasReply: false,
        });
      }
    }

    return {
      success: true,
      data: { checked: toCheck.length, replies: replyCount, results },
    };
  },
});
