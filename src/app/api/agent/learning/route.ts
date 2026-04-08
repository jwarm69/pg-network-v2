import { NextResponse } from "next/server";
import { getAllLearnedPreferences, getRecentSignals, getSignalCount } from "@/lib/db-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeSignals = url.searchParams.get("signals") === "true";

    const preferences = await getAllLearnedPreferences();
    const signalCount = await getSignalCount();

    const result: Record<string, unknown> = { preferences, signals: { total: signalCount, recent: [] } };

    if (includeSignals) {
      const recent = await getRecentSignals(20);
      result.signals = { total: signalCount, recent };
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
