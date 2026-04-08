import { registerTool } from "../registry";
import { updateThread } from "../../db";
import { sendGmailDraft } from "../../google-auth";
import type { ToolResult } from "../types";

interface SendDraftInput {
  draftId: string;
  threadId: string;
}

interface SendDraftOutput {
  messageId: string;
}

registerTool<SendDraftInput, SendDraftOutput>({
  name: "send_gmail_draft",
  description: "Send an existing Gmail draft. REQUIRES HUMAN APPROVAL before execution. This actually sends the email to the recipient.",
  category: "gmail",
  permissions: ["send"],
  gate: "approval_required",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", description: "Gmail draft ID" },
      threadId: { type: "string", description: "Outreach thread ID in our database" },
    },
    required: ["draftId", "threadId"],
  },
  async execute(input): Promise<ToolResult<SendDraftOutput>> {
    const { messageId } = await sendGmailDraft(input.draftId);

    await updateThread(input.threadId, { status: "active" });

    return {
      success: true,
      data: { messageId },
    };
  },
});
