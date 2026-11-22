import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { describeError } from "@/lib/api/problem";
import { cn } from "@/lib/utils";

/** Renders any API error (RFC 7807) in plain words: 409 with its blocking rules, 422 with its
 * field errors, 429 with the wait, network failures. */
export function ProblemAlert({ error, className }: { error: unknown; className?: string }) {
  const { title, message, items } = describeError(error);
  return (
    <Alert variant="destructive" className={cn("border-danger/40 bg-danger-bg", className)}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle className="text-danger">{title}</AlertTitle>
      <AlertDescription className="text-ink">
        <p>{message}</p>
        {items.length > 0 && (
          <ul className="mt-1 list-disc pl-4">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
