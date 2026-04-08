import {
  getApprovalGate,
  updateApprovalGate,
  getExpiredGates,
  updateAgentRun,
} from "../db-agent";
import type { ApprovalGate, GateStatus } from "./types";

export async function createGate(params: {
  runId: string;
  stepId?: string;
  gateType: string;
  payload: Record<string, unknown>;
}): Promise<ApprovalGate> {
  const { createApprovalGate } = await import("../db-agent");
  return createApprovalGate({
    runId: params.runId,
    stepId: params.stepId,
    gateType: params.gateType,
    payloadJson: JSON.stringify(params.payload),
  });
}

export async function resolveGate(
  gateId: string,
  action: "approved" | "rejected" | "edited",
  edits?: Record<string, unknown>
): Promise<{ runId: string; payload: string }> {
  const gate = await getApprovalGate(gateId);
  if (!gate) throw new Error(`Gate ${gateId} not found`);
  if (gate.status !== "pending") throw new Error(`Gate ${gateId} is already ${gate.status}`);

  const statusMap: Record<string, GateStatus> = {
    approved: "approved",
    rejected: "rejected",
    edited: "edited",
  };

  await updateApprovalGate(gateId, {
    status: statusMap[action],
    userEditsJson: edits ? JSON.stringify(edits) : undefined,
  });

  return { runId: gate.run_id, payload: gate.payload_json };
}

export async function checkExpiredGates(): Promise<number> {
  const expired = await getExpiredGates();
  let count = 0;

  for (const gate of expired) {
    await updateApprovalGate(gate.id, { status: "expired" });
    await updateAgentRun(gate.run_id, {
      status: "cancelled",
      error: "Approval gate expired after 72 hours",
      completed_at: new Date().toISOString(),
    });
    count++;
  }

  return count;
}

export function computeEditMagnitude(original: string, edited: string): number {
  if (!original || !edited) return 1;
  const origWords = original.split(/\s+/);
  const editWords = edited.split(/\s+/);

  let changed = 0;
  const maxLen = Math.max(origWords.length, editWords.length);
  for (let i = 0; i < maxLen; i++) {
    if (origWords[i] !== editWords[i]) changed++;
  }

  return changed / maxLen;
}
