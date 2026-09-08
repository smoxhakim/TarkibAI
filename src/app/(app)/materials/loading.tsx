export default function MaterialsLoading() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-surface-muted" />
      <div className="mt-6 h-10 w-full animate-pulse rounded bg-surface-muted" />
      <div className="mt-6 flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded bg-surface-muted" />
        ))}
      </div>
    </main>
  );
}
