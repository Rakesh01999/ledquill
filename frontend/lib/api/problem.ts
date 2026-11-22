import { ruleTitle } from "@/lib/invoices";

/** RFC 7807 problem details as the API returns them, turned into something the UI can show. */

export type FieldError = { loc: (string | number)[]; msg: string; type: string };

export class ApiProblem extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly errors: FieldError[];
  readonly blockingRules: string[];
  readonly retryAfter: number | null;
  readonly extra: Record<string, unknown>;

  constructor(status: number, body: unknown, retryAfter: number | null) {
    const b = isRecord(body) ? body : {};
    const detail = typeof b.detail === "string" ? b.detail : "";
    super(detail || `Request failed with status ${status}`);
    this.name = "ApiProblem";
    this.status = status;
    this.title = typeof b.title === "string" ? b.title : "Request failed";
    this.detail = detail;
    this.errors = Array.isArray(b.errors) ? (b.errors as FieldError[]) : [];
    this.blockingRules = Array.isArray(b.blocking_rules) ? (b.blocking_rules as string[]) : [];
    this.retryAfter = retryAfter;
    this.extra = b;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function problemFromResponse(response: Response, body: unknown): ApiProblem {
  const header = response.headers.get("retry-after");
  const seconds = header !== null && /^\d+$/.test(header) ? Number(header) : null;
  return new ApiProblem(response.status, body, seconds);
}

/** Server validation errors keyed by the last path segment, e.g. { total: "..." }. */
export function fieldErrors(problem: ApiProblem): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of problem.errors) {
    const key = String(e.loc[e.loc.length - 1] ?? "");
    if (key && !(key in out)) out[key] = e.msg;
  }
  return out;
}

export type ProblemMessage = { title: string; message: string; items: string[] };

/** Plain-language message for any thrown value. */
export function describeError(error: unknown): ProblemMessage {
  if (!(error instanceof ApiProblem)) {
    return {
      title: "Could not reach LedQuill",
      message: "Check your connection and try again.",
      items: [],
    };
  }
  switch (error.status) {
    case 409:
      return {
        title: error.blockingRules.length ? "Resolve the open errors first" : "Action not allowed now",
        message: error.detail || "The request conflicts with the current state.",
        items: error.blockingRules.map((id) => `${ruleTitle(id)} (${id})`),
      };
    case 422:
      return {
        title: "Some values are not valid",
        message: error.detail || "Check the highlighted fields and try again.",
        items: error.errors.map((e) => `${String(e.loc[e.loc.length - 1] ?? "value")}: ${e.msg}`),
      };
    case 429:
      return {
        title: "Too many requests",
        message:
          error.retryAfter !== null
            ? `Try again in ${error.retryAfter} ${error.retryAfter === 1 ? "second" : "seconds"}.`
            : "Wait a moment and try again.",
        items: [],
      };
    case 401:
      return {
        title: "The web app cannot sign in to the API",
        message: "The server-side API key is missing or wrong. Ask an administrator to check it.",
        items: [],
      };
    case 404:
      return { title: "Not found", message: error.detail || "That item no longer exists.", items: [] };
    case 502:
    case 503:
    case 504:
      return { title: "The API is not responding", message: "Try again in a few seconds.", items: [] };
    default:
      return { title: error.title, message: error.detail || "Something went wrong. Try again.", items: [] };
  }
}
