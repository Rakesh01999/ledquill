import createClient from "openapi-fetch";
import type { paths } from "./schema";
import type { ApiClient } from "./client";

/** Server-only client for server components. Reads the key from the server environment.
 * Import this only from server components and route handlers, never from a "use client" file. */
export function serverApi(): ApiClient {
  const baseUrl = process.env.LEDQUILL_API_URL;
  const key = process.env.LEDQUILL_API_KEY;
  if (!baseUrl || !key) throw new Error("LEDQUILL_API_URL and LEDQUILL_API_KEY must be set");
  return createClient<paths>({
    baseUrl,
    headers: { "X-API-Key": key },
    fetch: (request) => fetch(request, { cache: "no-store" }),
  });
}
