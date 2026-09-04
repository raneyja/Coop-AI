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
        description="Open VS Code and sign in from Settings → Account."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          <OpenVsCodeSignInButton />
          <InstallExtensionButton variant="secondary" className="w-full" />

          <AuthFooterLink prompt="New to CoopAI?" href="/signup/free" label="Create a free account" />
        </div>
      </section>
    </>
  );
}
