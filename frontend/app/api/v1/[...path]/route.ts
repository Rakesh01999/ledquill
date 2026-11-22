import type { NextRequest } from "next/server";

/**
 * Server-side proxy to the LedQuill API. The browser calls /api/v1/*; this handler adds the
 * X-API-Key header from the server environment and streams the request and response through.
 * The key never reaches the browser and any key the browser sends is dropped.
 */
export const dynamic = "force-dynamic";

const ALLOWED_ROOTS = new Set(["documents", "invoices", "jobs", "search", "stats", "health"]);
const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "content-length"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-length", "retry-after", "cache-control"];

function problem(status: number, title: string, detail: string): Response {
  return Response.json(
    { type: "about:blank", title, status, detail },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const root = path[0];
  if (!root || !ALLOWED_ROOTS.has(root) || path.some((s) => s === "" || s === "." || s === "..")) {
    return problem(404, "Not Found", "Unknown API path.");
  }
  const base = process.env.LEDQUILL_API_URL;
  const key = process.env.LEDQUILL_API_KEY;
  if (!base || !key) {
    return problem(500, "Internal Server Error", "The web server is not configured to reach the API.");
  }

  const target = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}`, base);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("X-API-Key", key);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // Node needs this flag to stream a request body.
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: req.signal,
    } as RequestInit);
  } catch {
    return problem(502, "Bad Gateway", "The API did not respond.");
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
