import { NextRequest, NextResponse } from "next/server";
import { handleCallback, isGoogleConfigured } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

// GET: handle OAuth callback from Google
export async function GET(request: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 503 });
  }

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    // User denied access
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return NextResponse.redirect(`${baseUrl}?gmail=denied`);
  }

  if (!code) {
    return NextResponse.json({ error: "No authorization code received" }, { status: 400 });
  }

  try {
    const { email } = await handleCallback(code);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return NextResponse.redirect(`${baseUrl}?gmail=connected&email=${encodeURIComponent(email)}`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return NextResponse.redirect(`${baseUrl}?gmail=error&message=${encodeURIComponent(message)}`);
  }
}
