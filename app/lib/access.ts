import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

export const ACCESS_COOKIE_NAME = "pothos_access";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 12;

function runtimeValue(key: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function secureEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signature(payload: string): Promise<string | null> {
  const secret = runtimeValue("POTHOS_SESSION_SECRET");
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signed));
}

export function verifyAccessCode(code: string): boolean {
  const expected = runtimeValue("POTHOS_ACCESS_CODE");
  return Boolean(expected && secureEqual(code.trim(), expected));
}

export async function createAccessToken(): Promise<string | null> {
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_COOKIE_MAX_AGE;
  const payload = String(expiresAt);
  const signed = await signature(payload);
  return signed ? `${payload}.${signed}` : null;
}

export async function isAccessTokenValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const payload = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expectedSignature = await signature(payload);
  return Boolean(expectedSignature && secureEqual(providedSignature, expectedSignature));
}

export async function hasAccessCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return isAccessTokenValid(cookieStore.get(ACCESS_COOKIE_NAME)?.value);
}

export async function requestHasAccess(request: Request): Promise<boolean> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCESS_COOKIE_NAME}=`))
    ?.slice(ACCESS_COOKIE_NAME.length + 1);
  return isAccessTokenValid(token ? decodeURIComponent(token) : undefined);
}
