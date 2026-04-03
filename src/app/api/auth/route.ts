import { NextResponse } from "next/server";
import { verifyPin, setSession } from "@/lib/auth";

export async function POST(request: Request) {
  const { pin } = await request.json();

  if (!pin) {
    return NextResponse.json({ error: "PIN required" }, { status: 400 });
  }

  const valid = await verifyPin(pin);
  if (!valid) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  await setSession();
  return NextResponse.json({ ok: true });
}
