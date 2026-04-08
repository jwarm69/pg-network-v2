import { NextResponse } from "next/server";
import { executeAgentRun, triggerContinuation } from "@/lib/agent/loop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { goal, targetId, trigger } = body;

    if (!goal || typeof goal !== "string") {
      return NextResponse.json({ error: "goal is required" }, { status: 400 });
    }

    const result = await executeAgentRun({ goal, targetId, trigger });

    // If still executing, trigger continuation in a new invocation
    if (result.status === "executing") {
      triggerContinuation(result.runId).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
