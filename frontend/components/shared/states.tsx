import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiProblem, describeError } from "@/lib/api/problem";

/** One line saying why it is empty, and the next action. */
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm text-ink-2">{title}</p>
      {action}
    </div>
  );
}

/** What failed in plain words, and a retry. Never a stack trace. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, message } = describeError(error);
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-[13px] text-ink-2">{message}</p>
      </div>
      {onRetry && !(error instanceof ApiProblem && error.status === 404) && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
