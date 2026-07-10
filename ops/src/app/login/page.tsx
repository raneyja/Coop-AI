"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, restoreSessionFromCookie } from "@/lib/auth";
import { startGoogleAuthUrl } from "@/lib/coopApi";
import { BrandMark } from "@/components/BrandMark";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("message") ?? params.get("error");
    if (oauthError) {
      setError(oauthError);
    }
  }, []);

  useEffect(() => {
    async function resumeSession() {
      const token = getToken();
      if (token) {
        router.replace("/");
        return;
      }
      const restored = await restoreSessionFromCookie();
      if (restored) {
        router.replace("/");
      }
    }
    void resumeSession();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">Ops Portal</h1>
          <p className="mt-2 text-sm text-coop-muted">
            Sign in with your allowlisted Google account to manage customer organizations.
          </p>
        </div>

        <div className="rounded-md border border-coop-border p-5">
          <a href={startGoogleAuthUrl()} className="admin-btn-primary block w-full py-2.5 text-center">
            Continue with Google
          </a>

          {error ? (
            <p className="mt-4 rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}
        </div>

        <p className="mt-6 text-center font-mono text-xs text-coop-muted">
          Operator access only. Session stored in this browser.
        </p>
      </div>
    </div>
  );
}
