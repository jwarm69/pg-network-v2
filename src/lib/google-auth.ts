import { google } from "googleapis";
import { getSetting, setSetting } from "./db";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",  // Create drafts + send
  "https://www.googleapis.com/auth/gmail.readonly",  // Read inbox for replies
];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function isGoogleConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleCallback(code: string): Promise<{ email: string }> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error("No refresh token received. Revoke access at myaccount.google.com/permissions and try again.");
  }

  // Store refresh token in DB
  await setSetting("google_refresh_token", tokens.refresh_token);
  if (tokens.access_token) {
    await setSetting("google_access_token", tokens.access_token);
  }
  if (tokens.expiry_date) {
    await setSetting("google_token_expiry", String(tokens.expiry_date));
  }

  // Get user email
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress || "unknown";

  await setSetting("google_email", email);

  return { email };
}

export async function getAuthedClient() {
  const refreshToken = await getSetting("google_refresh_token");
  if (!refreshToken) {
    throw new Error("Not authenticated. Connect Gmail first.");
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return oauth2Client;
}

export async function isGmailConnected(): Promise<boolean> {
  try {
    const token = await getSetting("google_refresh_token");
    return !!token;
  } catch {
    return false;
  }
}

// ─── Gmail Operations ───

export async function createGmailDraft(to: string, subject: string, body: string): Promise<{ draftId: string; threadId: string }> {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: "v1", auth });

  const senderEmail = await getSetting("google_email") || "me";

  // Build RFC 2822 message
  const rawMessage = [
    `From: ${senderEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    "",
    body,
  ].join("\r\n");

  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw: encodedMessage },
    },
  });

  return {
    draftId: draft.data.id || "",
    threadId: draft.data.message?.threadId || "",
  };
}

export async function sendGmailDraft(draftId: string): Promise<{ messageId: string }> {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: "v1", auth });

  const result = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id: draftId },
  });

  return { messageId: result.data.id || "" };
}

export async function checkForReplies(threadId: string): Promise<{ hasReply: boolean; replyText?: string; replyFrom?: string }> {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: "v1", auth });

  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const messages = thread.data.messages || [];
  if (messages.length <= 1) {
    return { hasReply: false };
  }

  // The last message that isn't from us
  const senderEmail = await getSetting("google_email");
  const replies = messages.filter((m) => {
    const from = m.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value || "";
    return !from.includes(senderEmail || "");
  });

  if (replies.length === 0) return { hasReply: false };

  const lastReply = replies[replies.length - 1];
  const replyFrom = lastReply.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value || "";

  // Extract body text
  let replyText = "";
  if (lastReply.payload?.body?.data) {
    replyText = Buffer.from(lastReply.payload.body.data, "base64").toString("utf-8");
  } else if (lastReply.snippet) {
    replyText = lastReply.snippet;
  }

  return { hasReply: true, replyText, replyFrom };
}
