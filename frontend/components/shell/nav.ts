import { Archive, FileText, LayoutGrid, ListChecks, Receipt, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: "review" };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/review", label: "Review queue", icon: ListChecks, badge: "review" },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/archived", label: "Archived", icon: Archive },
];
