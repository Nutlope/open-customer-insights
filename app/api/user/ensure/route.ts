import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export async function POST() {
  const t0 = performance.now();

  const { getToken } = await auth();
  console.log("[ensure] auth() took", Math.round(performance.now() - t0), "ms");

  const t1 = performance.now();
  const token = await getToken({ template: "convex" });
  console.log("[ensure] getToken() took", Math.round(performance.now() - t1), "ms");
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const t2 = performance.now();
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);
  try {
    await convex.action(api.users.ensureUser, {});
    console.log("[ensure] convex.action took", Math.round(performance.now() - t2), "ms");
    console.log("[ensure] total", Math.round(performance.now() - t0), "ms");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.log("[ensure] convex.action failed after", Math.round(performance.now() - t2), "ms");
    console.error("[ensure] Convex action failed:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
