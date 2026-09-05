export default function ProjectLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6" aria-busy="true">
      <div className="h-4 w-24 animate-pulse rounded bg-surface-muted" />
      <div className="mt-4 h-8 w-64 animate-pulse rounded bg-surface-muted" />
      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
    </main>
  );
}
