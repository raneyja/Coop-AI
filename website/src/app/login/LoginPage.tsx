import { PageHeader } from "@/components/PageHeader";
import { AuthFooterLink } from "@/components/AuthForm";
import { InstallExtensionButton } from "@/components/Button";
import { OpenVsCodeSignInButton } from "@/components/OpenVsCodeSignIn";

export default function LoginPage() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Sign in"
        description="Sign in happens in the CoopAI extension in VS Code — not in the browser."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-coop-muted">
            <li>Install the extension if you do not have it yet.</li>
            <li>Open CoopAI in VS Code. Your browser will ask to open VS Code.</li>
            <li>Sign in from Settings → Account (Google, email, or SSO).</li>
          </ol>

          <OpenVsCodeSignInButton />
          <InstallExtensionButton variant="secondary" className="w-full" />

          <AuthFooterLink prompt="New to CoopAI?" href="/signup/free" label="Create a free account" />
        </div>
      </section>
    </>
  );
}
