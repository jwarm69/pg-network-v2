import { cookies } from "next/headers";

const PIN = process.env.AUTH_PIN || "PG26";
const SESSION_COOKIE = "pg_session";

export async function verifyPin(pin: string): Promise<boolean> {
  return pin.toUpperCase() === PIN.toUpperCase();
}

export async function setSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value === "authenticated";
}
