import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type SpinnerProps = {
  className?: string;
  /** Screen-reader text; omit when the surrounding region already announces loading. */
  label?: string;
};

/**
 * The app's one loading indicator: a small spinning `Loader2`. Stops spinning for
 * reduced-motion users. With `label` it is a `role="status"` with sr-only text.
 */
export function Spinner({ className, label }: SpinnerProps) {
  const icon = (
    <Loader2
      aria-hidden
      className={cn("size-4 shrink-0 animate-spin motion-reduce:animate-none", className)}
    />
  );
  if (!label) return icon;
  return (
    <span role="status" className="inline-flex">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
