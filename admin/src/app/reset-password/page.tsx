import { redirect } from "next/navigation";

const MARKETING_SITE = "https://coop-ai.dev";

type Props = {
  searchParams: Promise<{ token?: string }>;
};

/** Password reset lives on the marketing site — redirect legacy/admin links. */
export default async function ResetPasswordRedirectPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = params.token?.trim();
  const destination = token
    ? `${MARKETING_SITE}/reset-password?token=${encodeURIComponent(token)}`
    : `${MARKETING_SITE}/forgot-password`;
  redirect(destination);
}
