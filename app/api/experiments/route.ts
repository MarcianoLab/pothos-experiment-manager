import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { experiments } from "../../../db/schema";

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    const [row] = await getDb().select().from(experiments).where(eq(experiments.id, id)).limit(1);
    if (!row) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ experiment: JSON.parse(row.payload) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "cloud unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { id?: string; sessionCode?: string; stage?: string; createdAt?: string; updatedAt?: string };
    if (!payload.id || !payload.sessionCode) return Response.json({ error: "invalid experiment" }, { status: 400 });
    const now = payload.updatedAt ?? new Date().toISOString();
    await getDb().insert(experiments).values({
      id: payload.id,
      sessionCode: payload.sessionCode,
      stage: payload.stage ?? "setup",
      payload: JSON.stringify(payload),
      createdAt: payload.createdAt ?? now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: experiments.id,
      set: { sessionCode: payload.sessionCode, stage: payload.stage ?? "setup", payload: JSON.stringify(payload), updatedAt: now },
    });
    return Response.json({ ok: true, savedAt: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "cloud unavailable" }, { status: 503 });
  }
}
