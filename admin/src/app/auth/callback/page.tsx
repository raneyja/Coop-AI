"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/coopApi";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("coopToken")?.trim();
    if (!token) {
      setError("No session token in callback URL.");
      return;
    }

    void (async () => {
      const result = await validateApiKey(token);
      if (!result.ok || !result.data) {
        setError(result.error ?? "SSO sign-in failed.");
        return;
      }
      saveSession(token, result.data);
      router.replace("/");
    })();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4 text-center">
      {error ? (
        <div>
          <p className="text-red-300">{error}</p>
          <a href="/login" className="admin-link mt-4 inline-block text-sm">
            Back to sign in
          </a>
        </div>
      ) : (
        <p className="text-coop-muted">Completing sign-in…</p>
      )}
    </div>
  );
}
