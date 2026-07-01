"use client";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-400">
        <h1 className="text-xl font-semibold text-white">Admin portal error</h1>
        <p className="max-w-md text-sm">Restart the admin dev server if this persists after a code change.</p>
        <button
          type="button"
          className="rounded border border-white/20 px-4 py-2 text-sm text-white"
          onClick={() => reset()}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
