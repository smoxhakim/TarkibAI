export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-surface-muted" />
      <div className="mt-6 h-10 w-full animate-pulse rounded bg-surface-muted" />
      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
    </main>
  );
}
