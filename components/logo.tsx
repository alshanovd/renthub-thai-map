import { cn } from "cn";

/** Placeholder mark: a house with the Thai letter บ. Plan 11 replaces it with the final mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <path d="M16 3 3 14h4v14h18V14h4L16 3Z" className="fill-rose-600" />
      <text
        x="16"
        y="25"
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        className="fill-white"
        fontFamily="system-ui, sans-serif"
      >
        บ
      </text>
    </svg>
  );
}

/** Mark plus the "Renthub Map" wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-semibold tracking-tight whitespace-nowrap">Renthub Map</span>
    </span>
  );
}
