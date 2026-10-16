/** Shown instantly while an org page loads (the sidebar stays put). */
export default function OrgPageLoading() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 animate-pulse rounded-full bg-border" />
        <div className="h-7 w-64 animate-pulse rounded-full bg-border" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-border" />
        ))}
      </div>
    </main>
  );
}
