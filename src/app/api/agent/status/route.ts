import { NextResponse } from "next/server";
import {
  getAllAgentRuns,
  getAgentRun,
  getStepsForRun,
  getToolCallsForRun,
  getGatesForRun,
} from "@/lib/db-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");
    const limit = parseInt(url.searchParams.get("limit") || "50");

    if (runId) {
      // Detailed view for a single run
      const [run, steps, toolCalls, gates] = await Promise.all([
        getAgentRun(runId),
        getStepsForRun(runId),
        getToolCallsForRun(runId),
        getGatesForRun(runId),
      ]);

      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }

      return NextResponse.json({ run, steps, toolCalls, gates });
    }

    // List all runs
    const runs = await getAllAgentRuns(limit);
    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
