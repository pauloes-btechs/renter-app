export default function Loading() {
  return (
    <div className="space-y-4 py-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-sand-200" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-sand-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-sand-200/70" />)}
      </div>
    </div>
  );
}
