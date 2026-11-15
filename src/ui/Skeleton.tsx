export function Skeleton({ rows }: { rows: number }) {
  return (
    <div aria-label="Loading" className="flex flex-col gap-2 p-3">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-muted" />)}
    </div>
  );
}
