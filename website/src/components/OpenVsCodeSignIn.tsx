"use client";

import { useState } from "react";
import { vscodeSignInHref } from "@/lib/vscodeSignIn";

export function OpenVsCodeSignInButton() {
  const [showFallback, setShowFallback] = useState(false);

  return (
    <div className="space-y-3">
      <a
        href={vscodeSignInHref()}
        className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-white hover:bg-[#46c35a]"
        onClick={() => {
          window.setTimeout(() => setShowFallback(true), 1500);
        }}
      >
        Open CoopAI in VS Code
      </a>
      {showFallback ? (
        <p className="text-center text-sm text-coop-muted">
          Didn't open? Install the extension, then try again.
        </p>
      ) : null}
    </div>
  );
}
