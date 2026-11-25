/**
 * Where the user was in a list, kept per browser tab in sessionStorage: the last URL of each list
 * page (page, size and filters live in it) and the scroll position of <main> for every URL.
 * Every access is wrapped: storage can be blocked, and the app must work without it.
 */

const SCROLL = "ledquill:scroll:";
const LIST = "ledquill:list:";

/** List pages whose last URL is remembered, so a breadcrumb can return to the same view. */
export const LIST_PATHS = ["/documents", "/invoices", "/review", "/archived"];

const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: nothing is remembered */
  }
};

export const currentUrl = (): string => window.location.pathname + window.location.search;

export function saveScroll(url: string, top: number): void {
  write(SCROLL + url, String(Math.round(top)));
}

export function savedScroll(url: string): number | null {
  const v = read(SCROLL + url);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rememberList(url: string): void {
  const path = url.split("?")[0] ?? "";
  if (LIST_PATHS.includes(path)) write(LIST + path, url);
}

/** The last URL seen for a list page ("/invoices" -> "/invoices?status=ready&page=3"), if any. */
export function recallList(path: string): string | null {
  return LIST_PATHS.includes(path) ? read(LIST + path) : null;
}

/** Set just before a link navigates to a remembered URL, so its scroll position is restored too. */
let restoreIntent: string | null = null;
export const markRestore = (url: string): void => {
  restoreIntent = url;
};
export function takeRestoreIntent(url: string): boolean {
  const hit = restoreIntent === url;
  restoreIntent = null;
  return hit;
}

/**
 * Where the user came from inside the app: set by ScrollRestore on every client navigation. A
 * page opened directly (link, reload) has none, so Back falls back to the remembered list.
 */
let previousPath: string | null = null;
export const notePreviousPath = (path: string): void => {
  previousPath = path;
};
/**
 * True when the page before this one came from somewhere in the app other than another invoice
 * (a list, a file page, the dashboard), so history Back lands where the user was. Stepping through
 * the review queue is not that: Back should leave the queue, not replay it.
 */
export const cameFromList = (): boolean => previousPath !== null && !previousPath.startsWith("/invoices/");
