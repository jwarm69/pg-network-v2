import { NextResponse } from "next/server";
import { getAuthUrl, isGoogleConfigured, isGmailConnected } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

// GET: initiate OAuth flow OR check connection status
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  // Check status
  if (action === "status") {
    const configured = isGoogleConfigured();
    const connected = configured ? await isGmailConnected() : false;
    return NextResponse.json({ configured, connected });
  }

  // Initiate OAuth
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  const authUrl = getAuthUrl();
  return NextResponse.redirect(authUrl);
}
