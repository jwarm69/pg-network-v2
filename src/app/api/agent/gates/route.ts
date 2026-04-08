import { NextResponse } from "next/server";
import { getPendingGates, getGatesForRun } from "@/lib/db-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");

    const gates = runId ? await getGatesForRun(runId) : await getPendingGates();

    // Enrich with parsed payloads
    const enriched = gates.map((gate) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(gate.payload_json);
      } catch { /* ignore */ }

      return {
        ...gate,
        payload,
      };
    });

    return NextResponse.json({ gates: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
