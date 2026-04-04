import { NextResponse } from "next/server";
import {
  isDbConfigured,
  getTargets,
  createTarget,
  updateTarget,
  deleteTarget,
  type Target,
} from "@/lib/db";

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
    const data = await updateTarget(id, updates);
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
