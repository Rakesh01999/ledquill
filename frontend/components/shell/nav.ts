import { FileText, LayoutGrid, ListChecks, Receipt, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: "review" };

export const NAV_ITEMS: NavItem[] = [
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/review", label: "Review queue", icon: ListChecks, badge: "review" },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
];

/** Title shown in the top bar for the current route. */
export function titleFor(pathname: string): string {
  if (pathname.startsWith("/invoices/")) return "Invoice review";
  if (pathname.startsWith("/documents/")) return "Document";
  return NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.label ?? "LedQuill";
}
