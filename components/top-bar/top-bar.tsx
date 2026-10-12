/** Placeholder top bar; plan 09 adds the mode toggle, slider, switch, Search and sort. */
export function TopBar({ resultCount }: { resultCount: number }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <span className="font-semibold tracking-tight">renthub map</span>
      <span className="text-sm text-muted-foreground">{resultCount} results</span>
    </header>
  );
}
