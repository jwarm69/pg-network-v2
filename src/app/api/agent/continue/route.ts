import { NextResponse } from "next/server";
import { executeNextStep, triggerContinuation } from "@/lib/agent/loop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  // Validate internal secret if configured
  const secret = process.env.AGENT_INTERNAL_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const { runId } = await request.json();
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const result = await executeNextStep(runId);

    // Self-continue if still executing
    if (result.status === "executing") {
      triggerContinuation(runId).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
