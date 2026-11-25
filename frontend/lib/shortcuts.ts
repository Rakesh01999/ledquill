"use client";

import { useEffect } from "react";

type Handlers = Record<string, () => void>;

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  // Custom text widgets and selects (a shadcn Select trigger is a button with role=combobox).
  return target.closest('[role="combobox"], [role="textbox"], [role="listbox"], [role="menu"]') !== null;
}

/**
 * Single-key shortcuts (`/`, `j`, `k`, `a`, `e`). They never fire while typing in a field, with a
 * modifier held, or while a dialog is open, so they cannot interfere with normal input.
 */
export function useShortcuts(handlers: Handlers): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A held key must not approve invoice after invoice, so auto-repeat is ignored.
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const handler = handlers[event.key.toLowerCase()];
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
