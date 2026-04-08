import { NextResponse } from "next/server";
import {
  createExperiment,
  getAllExperiments,
  getExperimentAssignments,
} from "@/lib/db-agent";
import { analyzeExperiment } from "@/lib/agent/experiments";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const experimentId = url.searchParams.get("experimentId");

    if (experimentId) {
      const assignments = await getExperimentAssignments(experimentId);
      const analysis = await analyzeExperiment(experimentId);
      return NextResponse.json({ assignments, analysis });
    }

    const experiments = await getAllExperiments();
    return NextResponse.json({ experiments });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, hypothesis, variable, variants, metric, minSamples } = body;

    if (!name || !hypothesis || !variable || !variants || !metric) {
      return NextResponse.json(
        { error: "name, hypothesis, variable, variants, and metric are required" },
        { status: 400 }
      );
    }

    const experiment = await createExperiment({
      name,
      hypothesis,
      variable,
      variantsJson: JSON.stringify(variants),
      metric,
      minSamples,
    });

    return NextResponse.json({ experiment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
