"use client";

import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-coop-dark px-6 text-center text-coop-muted">
      <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
      <p className="max-w-md text-sm">
        The admin portal hit an error loading this page. If you just changed code, restart the dev server and clear{" "}
        <code className="text-white">admin/.next</code>.
      </p>
      <button type="button" className="admin-btn-primary" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
