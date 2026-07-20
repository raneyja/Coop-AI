"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getAdminPortalLoginUrl } from "@/lib/adminPortal";

const PREVIEW_COPY: Record<string, { title: string; body: string }> = {
  activate: {
    title: "Activate account (preview)",
    body: "In a real Pro checkout welcome email, this button opens a one-time link where you set your password and get signed in."
  },
  invite: {
    title: "Accept invitation (preview)",
    body: "In a real invite email, this button opens a one-time link where the teammate creates a password and joins the org."
  },
  verify: {
    title: "Verify email (preview)",
    body: "In a real verification email, this button confirms the address. Free signup already created your password before this email was sent."
  },
  reset: {
    title: "Reset password (preview)",
    body: "In a real reset email, this button opens a one-hour form to choose a new password."
  }
};

export function EmailPreviewContent() {
  const searchParams = useSearchParams();
  const type = (searchParams.get("type")?.trim().toLowerCase() ?? "").trim();
  const copy = PREVIEW_COPY[type] ?? {
    title: "Email layout preview",
    body: "This page is only for reviewing transactional email layout. Live customer emails use one-time tokens that work once."
  };
  const adminLoginUrl = getAdminPortalLoginUrl();

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title={copy.title}
        description="This was a QA layout preview — the button you clicked is not a live account link."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          <p className="text-sm leading-relaxed text-coop-muted">{copy.body}</p>
          <p className="text-sm leading-relaxed text-coop-muted">
            Production invites, verification, and password resets mint real tokens in the database. Preview emails
            intentionally do not, so clicking them never activates an account by accident.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <a
              href={adminLoginUrl}
              className="font-medium text-gray-900 underline-offset-2 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Sign in to admin portal
            </a>
            <Link href="/signup/free" className="font-medium text-gray-900 underline-offset-2 hover:underline">
              Create a free account
            </Link>
            <Link href="/forgot-password" className="font-medium text-gray-900 underline-offset-2 hover:underline">
              Forgot password
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
