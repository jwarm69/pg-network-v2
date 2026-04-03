import { NextResponse } from "next/server";
import { supabase, isSupabaseConfigured, type Target } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json([]);
  }

  const { data, error } = await supabase
    .from("targets")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(request: Request) {
  const body = await request.json();

  const target: Partial<Target> = {
    name: body.name,
    type: body.type || "celebrity",
    status: body.status || "new",
    priority: body.priority || "medium",
    channel: body.channel || "",
    score: body.score || null,
    notes: body.notes || "",
  };

  const { data, error } = await supabase
    .from("targets")
    .insert(target)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "Target ID required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("targets")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "Target ID required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("targets")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
