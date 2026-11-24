/** LedQuill lighthouse mark: two white bars and a shorter orange bar. The
 * orange is a fill here and in the review badge only, never text. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-7 flex-none items-center justify-center gap-[3px] rounded-md bg-logo ${className ?? ""}`}
    >
      <span className="h-3.5 w-[3px] rounded-sm bg-white" />
      <span className="mt-[5px] h-2.5 w-[3px] rounded-sm bg-accent-mark" />
      <span className="h-3.5 w-[3px] rounded-sm bg-white" />
    </span>
  );
}
