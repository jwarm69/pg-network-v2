import { registerTool } from "../registry";
import { getMessageById, updateThread, updateMessage } from "../../db";
import { createGmailDraft } from "../../google-auth";
import type { ToolResult } from "../types";

interface CreateDraftInput {
  messageId: string;
  to: string;
  subject?: string;
}

interface CreateDraftOutput {
  draftId: string;
  threadId: string;
  to: string;
  subject: string;
}

registerTool<CreateDraftInput, CreateDraftOutput>({
  name: "create_gmail_draft",
  description: "Create a Gmail draft from a message in the database. REQUIRES HUMAN APPROVAL before execution. The draft will appear in Gmail's drafts folder.",
  category: "gmail",
  permissions: ["write"],
  gate: "approval_required",
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Message ID from the messages table" },
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject (optional, uses message subject)" },
    },
    required: ["messageId", "to"],
  },
  async execute(input): Promise<ToolResult<CreateDraftOutput>> {
    const message = await getMessageById(input.messageId);
    if (!message) {
      return { success: false, error: `Message ${input.messageId} not found` };
    }

    const subject = input.subject || message.subject;
    const { draftId, threadId } = await createGmailDraft(input.to, subject, message.body);

    // Update thread with Gmail IDs
    await updateThread(message.thread_id, {
      gmail_draft_id: draftId,
      gmail_thread_id: threadId,
      status: "ready_for_review",
    });

    return {
      success: true,
      data: { draftId, threadId, to: input.to, subject },
    };
  },
});
