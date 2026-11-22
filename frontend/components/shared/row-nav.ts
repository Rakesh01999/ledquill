import type { KeyboardEvent } from "react";

/** Up and Down arrows move focus between the row links of a table (`data-row-link`). */
export function rowNavKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-row-link]")];
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (index < 0) return;
  event.preventDefault();
  links[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
}
