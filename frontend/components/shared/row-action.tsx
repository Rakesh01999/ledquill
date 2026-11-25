import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One action button of a row or a page header: an icon (always size-4, same gap) and a text
 * label. `compact` keeps the label for screen readers only below xl, where a table row has no
 * room for three words; the button then relies on its `title` and accessible name.
 *
 * `label` is the visible word ("Archive"); `name` is the full accessible name ("Archive
 * register_01.xlsx"), which starts with the visible word.
 */
export function RowAction({
  icon: Icon,
  label,
  name,
  href,
  onClick,
  disabled,
  title,
  tone = "link",
  variant = "ghost",
  compact = false,
  decorative = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  name?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Explains why the button is disabled; otherwise it names the action. */
  title?: string;
  tone?: "link" | "muted";
  variant?: "ghost" | "outline";
  compact?: boolean;
  /** A link that repeats another link of the row: out of the tab order and hidden from readers. */
  decorative?: boolean;
  className?: string;
}) {
  const classes = cn(tone === "link" ? "text-link" : "text-ink-2", compact && "max-xl:px-2 max-xl:has-[>svg]:px-2", className);
  const content = (
    <>
      <Icon aria-hidden="true" />
      <span className={cn(compact && "max-xl:sr-only")}>{label}</span>
    </>
  );
  if (href) {
    return (
      <Button asChild variant={variant} size="sm" className={classes}>
        <Link
          href={href}
          title={title ?? name ?? label}
          {...(decorative ? { tabIndex: -1, "aria-hidden": true } : { "aria-label": name })}
        >
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={classes}
      disabled={disabled}
      title={title ?? name ?? label}
      aria-label={name}
      onClick={onClick}
    >
      {content}
    </Button>
  );
}
