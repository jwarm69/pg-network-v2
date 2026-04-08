import { NextResponse } from "next/server";
import { resumeAfterApproval, triggerContinuation } from "@/lib/agent/loop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { gateId, action, edits } = body;

    if (!gateId || typeof gateId !== "string") {
      return NextResponse.json({ error: "gateId is required" }, { status: 400 });
    }

    if (!["approved", "rejected", "edited"].includes(action)) {
      return NextResponse.json({ error: "action must be approved, rejected, or edited" }, { status: 400 });
    }

    const result = await resumeAfterApproval(gateId, action, edits);

    // Continue if still executing
    if (result.status === "executing") {
      triggerContinuation(result.runId).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
