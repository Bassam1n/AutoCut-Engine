export function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-64 w-72 shrink-0 animate-pulse rounded-2xl bg-border" />
      ))}
    </div>
  );
}
