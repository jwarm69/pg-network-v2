import { NextResponse } from "next/server";
import { executeAgentRun } from "@/lib/agent/loop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { goal, targetId, trigger } = body;

    if (!goal || typeof goal !== "string") {
      return NextResponse.json({ error: "goal is required" }, { status: 400 });
    }

    // The loop runs in-process within the 60s Vercel time budget
    const result = await executeAgentRun({ goal, targetId, trigger });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Agent run error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
