import {
  ACCESS_COOKIE_MAX_AGE,
  ACCESS_COOKIE_NAME,
  createAccessToken,
  verifyAccessCode,
} from "../../lib/access";

export async function POST(request: Request) {
  let code = "";
  try {
    const body = await request.json() as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    // Invalid request bodies are handled like an incorrect code.
  }

  if (!verifyAccessCode(code)) {
    return Response.json({ error: "incorrect code" }, { status: 401 });
  }

  const token = await createAccessToken();
  if (!token) {
    return Response.json({ error: "access is not configured" }, { status: 503 });
  }

  const response = Response.json({ ok: true });
  response.headers.append(
    "set-cookie",
    `${ACCESS_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_COOKIE_MAX_AGE}`,
  );
  return response;
}
