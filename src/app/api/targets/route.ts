import { NextResponse } from "next/server";
import {
  isDbConfigured,
  getTargets,
  getTarget,
  createTarget,
  updateTarget,
  deleteTarget,
  type Target,
} from "@/lib/db";
import { signalUserOverride } from "@/lib/agent/signals";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json([]);
  }

  try {
    const data = await getTargets();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json();

  const target: Omit<Target, "id" | "created_at" | "updated_at"> = {
    name: body.name,
    type: body.type || "celebrity",
    status: body.status || "new",
    priority: body.priority || "medium",
    channel: body.channel || "",
    score: body.score || null,
    notes: body.notes || "",
    source: body.source || "manual",
    created_by_run_id: body.created_by_run_id || null,
  };

  try {
    const data = await createTarget(target);
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "Target ID required" }, { status: 400 });
  }

  try {
    const before = await getTarget(id);
    const data = await updateTarget(id, updates);

    // Emit learning signals for manual overrides
    if (before) {
      for (const [field, newVal] of Object.entries(updates)) {
        const oldVal = (before as unknown as Record<string, unknown>)[field];
        if (String(oldVal) !== String(newVal)) {
          signalUserOverride({ targetId: id, field, oldValue: String(oldVal ?? ""), newValue: String(newVal) }).catch(() => {});
        }
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "Target ID required" }, { status: 400 });
  }

  try {
    await deleteTarget(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
