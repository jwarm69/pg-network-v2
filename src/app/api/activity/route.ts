import { NextResponse } from "next/server";
import { isDbConfigured, getActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json([]);
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const targetId = searchParams.get("targetId");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  try {
    const data = await getActivity(limit, targetId || undefined);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Error fetching activity:", err);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 }
    );
  }
}
