export default function CostSettingsLoading() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded bg-surface-muted" />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-md bg-surface-muted" />
        ))}
      </div>
    </main>
  );
}
