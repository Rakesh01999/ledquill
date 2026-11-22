import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { problemFromResponse } from "./problem";

export type ApiClient = ReturnType<typeof createClient<paths>>;

/** Browser client. Calls go to this app's own /api/v1/* route handler, which adds the API key
 * on the server. The key never exists in the browser. */
export const api: ApiClient = createClient<paths>({ baseUrl: "" });

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Resolve to the data or throw an ApiProblem. A 204 resolves to undefined. */
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok) throw problemFromResponse(response, error);
  return data as T;
}
