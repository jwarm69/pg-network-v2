import { emitLearningSignal } from "../db-agent";
import type { SignalType } from "./types";

export async function emitSignal(params: {
  signalType: SignalType;
  targetId?: string;
  runId?: string;
  threadId?: string;
  messageId?: string;
  value: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    await emitLearningSignal({
      targetId: params.targetId,
      runId: params.runId,
      threadId: params.threadId,
      messageId: params.messageId,
      signalType: params.signalType,
      signalValue: params.value,
      contextJson: params.context ? JSON.stringify(params.context) : undefined,
    });
  } catch (err) {
    // Fire and forget - don't let signal emission break the flow
    console.error("Failed to emit learning signal:", err);
  }
}

// Convenience helpers for common signal patterns

export async function signalMessageSent(params: {
  targetId: string;
  threadId: string;
  messageId: string;
  channel: string;
}): Promise<void> {
  await emitSignal({
    signalType: "message_sent",
    targetId: params.targetId,
    threadId: params.threadId,
    messageId: params.messageId,
    value: JSON.stringify({ channel: params.channel, sentAt: new Date().toISOString() }),
  });
}

export async function signalReplyReceived(params: {
  targetId: string;
  threadId: string;
  replyText: string;
  replyFrom: string;
  sentiment?: string;
}): Promise<void> {
  await emitSignal({
    signalType: "reply_received",
    targetId: params.targetId,
    threadId: params.threadId,
    value: JSON.stringify({
      replyFrom: params.replyFrom,
      replyLength: params.replyText.length,
      receivedAt: new Date().toISOString(),
    }),
  });

  if (params.sentiment) {
    await emitSignal({
      signalType: "reply_sentiment",
      targetId: params.targetId,
      threadId: params.threadId,
      value: params.sentiment,
    });
  }
}

export async function signalUserOverride(params: {
  targetId: string;
  field: string;
  oldValue: string;
  newValue: string;
}): Promise<void> {
  await emitSignal({
    signalType: "user_override",
    targetId: params.targetId,
    value: JSON.stringify({
      field: params.field,
      oldValue: params.oldValue,
      newValue: params.newValue,
    }),
  });
}

export async function signalAngleSelected(params: {
  targetId: string;
  runId?: string;
  threadId?: string;
  angle: string;
}): Promise<void> {
  await emitSignal({
    signalType: "angle_selected",
    targetId: params.targetId,
    runId: params.runId,
    threadId: params.threadId,
    value: params.angle,
  });
}
