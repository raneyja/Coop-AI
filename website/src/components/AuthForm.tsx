"use client";

import Link from "next/link";
import { getGoogleAuthStartUrl } from "@/lib/auth";

type GoogleAuthButtonProps = {
  mode: "signup" | "login";
  orgName?: string;
  disabled?: boolean;
};

export function GoogleAuthButton({ mode, orgName, disabled }: GoogleAuthButtonProps) {
  const label = mode === "signup" ? "Sign up with Google" : "Sign in with Google";

  function handleClick() {
    if (disabled) {
      return;
    }
    window.location.href = getGoogleAuthStartUrl({ mode, orgName });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-sm border border-coop-border bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
    >
      <GoogleIcon />
      {label}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

type AuthDividerProps = {
  label?: string;
};

export function AuthDivider({ label = "or" }: AuthDividerProps) {
  return (
    <div className="relative py-1">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <div className="w-full border-t border-coop-border" />
      </div>
      <div className="relative flex justify-center text-xs uppercase tracking-wide">
        <span className="bg-white px-2 text-coop-muted">{label}</span>
      </div>
    </div>
  );
}

type AuthFooterLinkProps = {
  prompt: string;
  href: string;
  label: string;
};

export function AuthFooterLink({ prompt, href, label }: AuthFooterLinkProps) {
  return (
    <p className="text-center text-sm text-coop-muted">
      {prompt}{" "}
      <Link href={href} className="font-medium text-gray-900 hover:underline">
        {label}
      </Link>
    </p>
  );
}
