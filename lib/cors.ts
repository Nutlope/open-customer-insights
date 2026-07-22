import { APP_URL } from "./constants";

const ALLOWED = ["http://localhost:3000", APP_URL];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED.includes(origin) ? origin : "";
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, x-demo-secret, Authorization",
  };
}

export function handleOptions(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}