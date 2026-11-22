"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Missing } from "@/components/shared/money";
import { formatDate, formatDecimal } from "@/lib/format";
import {
  confidenceLevel,
  isChanged,
  parseEdit,
  type FieldDef,
  type Issue,
} from "@/lib/invoices";
import { cn } from "@/lib/utils";

export type FieldRowProps = {
  def: FieldDef;
  value: string | null;
  confidence: number | undefined;
  edited: boolean;
  pageLabel: string | null;
  issues: Issue[];
  saving: boolean;
  serverError?: string;
  onSave: (value: string | null) => void;
  onShowPage: () => void;
};

function display(def: FieldDef, value: string | null): string | null {
  if (value === null) return null;
  if (def.kind === "money") return formatDecimal(value) ?? value;
  if (def.kind === "date") return formatDate(value) ?? value;
  return value;
}

/**
 * One field: value, confidence marker, source page, and inline edit. Click the value (or press
 * Enter on it) to edit; Enter saves, Escape cancels. Nothing is sent when the value is unchanged.
 */
export function FieldRow({
  def,
  value,
  confidence,
  edited,
  pageLabel,
  issues,
  saving,
  serverError,
  onSave,
  onShowPage,
}: FieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const level = edited ? null : confidenceLevel(confidence);
  const hasError = issues.some((i) => i.severity === "error");
  const error = localError ?? serverError ?? null;
  const inputId = `edit-${def.name}`;
  const errorId = `${inputId}-error`;

  function start() {
    setDraft(value ?? "");
    setLocalError(null);
    setEditing(true);
  }

  function stop() {
    setEditing(false);
    setLocalError(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  function submit() {
    const parsed = parseEdit(def.kind, draft);
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    if (!isChanged(def.kind, value, parsed.value)) {
      stop(); // unchanged: no request, no correction row
      return;
    }
    onSave(parsed.value);
    stop();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      stop();
    }
  }

  const shown = display(def, value);

  return (
    <div
      className={cn(
        "relative grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-1 border-l-2 px-3 py-2.5 sm:grid-cols-[132px_minmax(0,1fr)]",
        hasError ? "border-danger" : issues.length > 0 ? "border-warn-dot" : "border-transparent",
        level === "low" && value !== null && "bg-warn-field",
      )}
    >
      <label htmlFor={editing ? inputId : `field-${def.name}`} className="pt-1.5 text-xs text-ink-2">
        {def.label}
      </label>
      <div className="min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <input
              id={inputId}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              type={def.kind === "date" ? "date" : "text"}
              inputMode={def.kind === "money" ? "decimal" : undefined}
              autoComplete="off"
              maxLength={def.kind === "currency" ? 3 : 200}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                "h-8 w-full rounded-md border bg-surface px-2.5 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring",
                def.kind === "money" && "text-right tabular-nums",
                error ? "border-danger" : "border-line-strong",
              )}
            />
            {error && (
              <p id={errorId} role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={stop}>
                Cancel
              </Button>
              <span className="text-xs text-ink-3">Your edit is logged with the original value.</span>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              ref={trigger}
              id={`field-${def.name}`}
              type="button"
              onClick={start}
              aria-label={`Edit ${def.label}${shown ? `, current value ${shown}` : ", not found in document"}`}
              className={cn(
                "group -mx-1.5 flex min-h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] font-medium outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring",
                def.kind === "money" && "tabular-nums",
              )}
            >
              <span className="min-w-0 break-words">{shown ?? <Missing />}</span>
              <Pencil
                className="size-3 flex-none text-ink-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden="true"
              />
            </button>

            {edited && (
              <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-link">Edited</span>
            )}
            {level === "medium" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                    <span className="size-2 rounded-full bg-warn-dot" aria-hidden="true" />
                    <span className="sr-only">Medium confidence. </span>
                    <span className="sr-only">Confidence {confidence?.toFixed(2)}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Medium confidence ({confidence?.toFixed(2)}). Check this value.</TooltipContent>
              </Tooltip>
            )}
            {level === "low" && value !== null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs font-medium text-warn">Low confidence</span>
                </TooltipTrigger>
                <TooltipContent>Confidence {confidence?.toFixed(2)}. Compare with the source page.</TooltipContent>
              </Tooltip>
            )}
            {value !== null && pageLabel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onShowPage}
                    className="rounded-md border border-line px-1.5 py-0.5 text-xs text-ink-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {pageLabel}
                    <span className="sr-only">. Show this page in the source panel</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {edited ? "Entered by a reviewer" : "Read from the document text during extraction"}. Show the page.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
