"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  defaultHomePath,
  establishSessionCookie,
  meFromAuthPayload,
  restoreSessionFromCookie,
  saveSession
} from "@/lib/auth";
import { isOrgSuspendedResult, validateSession } from "@/lib/coopApi";
import { OrgSuspendedOverlay } from "@/components/OrgSuspendedOverlay";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [orgSuspended, setOrgSuspended] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("coopToken")?.trim();
    const refreshToken = params.get("coopRefresh")?.trim();
    // Strip any SAML-delivered token from the URL bar before network work.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    void (async () => {
      if (!token) {
        const restored = await restoreSessionFromCookie();
        if (!restored) {
          setError("Sign-in session was unavailable. Please try again.");
          return;
        }
        router.replace(defaultHomePath(restored));
        return;
      }
      const result = await validateSession(token);
      if (!result.ok || !result.data) {
        if (isOrgSuspendedResult(result)) {
          setOrgSuspended(true);
          return;
        }
        setError(result.error ?? "Sign-in failed.");
        return;
      }
      if (!(await establishSessionCookie(token, refreshToken))) {
        setError("Could not establish your sign-in session. Please try again.");
        return;
      }
      const me = meFromAuthPayload(result.data);
      saveSession(me);
      router.replace(defaultHomePath(me));
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
      ) : orgSuspended ? null : (
        <p className="text-coop-muted">Completing sign-in…</p>
      )}
      <OrgSuspendedOverlay
        open={orgSuspended}
        variant="sign-in"
        onDismiss={() => router.replace("/login")}
      />
    </div>
  );
}
