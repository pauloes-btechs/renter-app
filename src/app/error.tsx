"use client";
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="font-display text-3xl">Something went wrong</div>
      <p className="mt-3 text-ink-500">{error.message || "An unexpected error occurred."}</p>
      <button className="mt-6 rounded-full bg-pine-600 px-5 py-2.5 text-sm font-medium text-white" onClick={reset}>Try again</button>
    </div>
  );
}
