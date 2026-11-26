import { SunMoon, type LucideIcon } from "lucide-react";
import { NAV_ITEMS } from "./nav";

export type PaletteItem =
  | { key: string; kind: "page"; label: string; icon: LucideIcon; href: string; keywords: readonly string[] }
  | { key: string; kind: "action"; label: string; icon: LucideIcon; action: "toggle-theme"; keywords: readonly string[] };

/** The pages of the side menu, and the one action the palette offers. Static: no request is made. */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  ...NAV_ITEMS.map(
    (n): PaletteItem => ({ key: `page:${n.href}`, kind: "page", label: n.label, icon: n.icon, href: n.href, keywords: [] }),
  ),
  { key: "action:toggle-theme", kind: "action", label: "Toggle theme", icon: SunMoon, action: "toggle-theme", keywords: ["theme", "dark", "light"] },
];

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Items for the typed text. Empty text lists everything. Otherwise every space-separated part of
 * the text must be the start of a word of the label or of a keyword, so "rev" finds the Review
 * queue but invoice-like text ("INV-204", "2970") finds no page and Enter goes to the invoice.
 * Plain string comparison only: the text is never turned into a pattern.
 */
export function matchItems(text: string, items: readonly PaletteItem[] = PALETTE_ITEMS): PaletteItem[] {
  const parts = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [...items];
  return items.filter((item) => {
    const candidates = [...words(item.label), ...item.keywords.flatMap(words)];
    return parts.every((part) => candidates.some((word) => word.startsWith(part)));
  });
}
