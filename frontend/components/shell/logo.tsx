import Link from "next/link";

/**
 * LedQuill mark: a lighthouse with an orange lamp on a navy square. The same drawing is the
 * favicon (app/icon.svg). Colours are fixed so the mark looks the same in light and dark.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={`size-7 flex-none ${className ?? ""}`}>
      <rect width="32" height="32" rx="7" fill="#1F2C7A" />
      <path d="M3 6.5 12 9v2L3 13.5z" fill="#fff" fillOpacity=".55" />
      <path d="M29 6.5 20 9v2l9 2.5z" fill="#fff" fillOpacity=".55" />
      <path d="M13.2 7.6 16 4.8l2.8 2.8z" fill="#fff" />
      <rect x="14" y="7.6" width="4" height="4" fill="#EF7A2E" />
      <rect x="12" y="11.6" width="8" height="2" rx=".6" fill="#fff" />
      <path d="M13.6 13.6h4.8L20 26h-8z" fill="#fff" />
      <rect x="8.5" y="26" width="15" height="2.2" rx=".8" fill="#fff" />
    </svg>
  );
}

/** The mark (and optionally the name) as a link to the app's first page, Documents. */
export function LogoLink({ showName = true, onNavigate }: { showName?: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/documents"
      onClick={onNavigate}
      aria-label="LedQuill, go to Documents"
      className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <LogoMark />
      {showName && <span className="text-sm leading-tight font-semibold">LedQuill</span>}
    </Link>
  );
}
