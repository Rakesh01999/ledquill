"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";

/**
 * A text input that commits its value 300 ms after typing stops. `value` is the committed value
 * (from the URL): when it changes from outside, the draft follows it.
 */
export function DebouncedInput({
  value,
  onCommit,
  delay = 300,
  ...props
}: { value: string; onCommit: (value: string) => void; delay?: number } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // Adjust state while rendering, the React-recommended way to follow a changed prop.
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onCommit(draft), delay);
    return () => clearTimeout(timer);
  }, [draft, value, delay, onCommit]);

  return <input {...props} value={draft} onChange={(e) => setDraft(e.target.value)} />;
}
