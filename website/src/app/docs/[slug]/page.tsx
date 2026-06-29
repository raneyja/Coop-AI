import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsArticleLayout } from "@/components/DocsArticleLayout";
import { getAdjacentDocs, getAllDocs, getDocBySlug, getDocNav, getDocsSections } from "@/lib/docs";

const nextStepsBySlug: Record<string, { href: string; label: string }[]> = {
  "getting-started": [
    { href: "/docs/install-extension", label: "Install the VS Code extension" },
    { href: "/docs/extension-settings", label: "Extension settings reference" },
    { href: "/manual#quick-actions", label: "Quick actions in the Owner's Manual" }
  ],
  "install-extension": [
    { href: "/docs/extension-settings", label: "Configure extension settings" },
    { href: "/manual#using-the-extension", label: "Using the extension" }
  ],
  "extension-settings": [
    { href: "/docs/connect-integrations", label: "Connect integrations (admin)" },
    { href: "/manual#prompt-library", label: "Prompt library" }
  ],
  "admin-portal": [
    { href: "/docs/connect-integrations", label: "Connect integrations" },
    { href: "/docs/integration-scope", label: "Configure integration scope" }
  ],
  "connect-integrations": [
    { href: "/docs/github", label: "GitHub setup" },
    { href: "/docs/slack", label: "Slack setup" }
  ],
  "integration-scope": [
    { href: "/docs/admin-portal", label: "Admin portal overview" },
    { href: "/docs/troubleshooting", label: "Troubleshooting" }
  ],
  "github": [{ href: "/docs/connect-integrations", label: "Integration overview" }],
  "slack": [{ href: "/docs/integration-scope", label: "Slack scope configuration" }],
  "jira": [{ href: "/docs/connect-integrations", label: "Integration overview" }],
  "notion": [{ href: "/docs/connect-integrations", label: "Integration overview" }],
  "google-docs": [{ href: "/docs/connect-integrations", label: "Integration overview" }],
  "plans-billing": [
    { href: "/pricing", label: "Pricing page" },
    { href: "/signup/free", label: "Free developer signup" }
  ],
  "api-reference": [
    { href: "/docs/zero-retention", label: "Zero-retention LLM routing" },
    { href: "/docs/enterprise-deployment", label: "Enterprise deployment" }
  ],
  "security-architecture": [
    { href: "/security", label: "Full security page" },
    { href: "/docs/zero-retention", label: "Zero-retention configuration" }
  ],
  "zero-retention": [{ href: "/docs/enterprise-deployment", label: "Enterprise deployment" }],
  "enterprise-deployment": [
    { href: "/docs/security-architecture", label: "Security architecture" },
    { href: "/enterprise", label: "Enterprise product page" }
  ],
  troubleshooting: [{ href: "/docs/faq", label: "Frequently asked questions" }],
  faq: [{ href: "/demo", label: "Contact support" }]
};

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getAllDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) {
    return { title: "Not found" };
  }

  return {
    title: doc.title,
    description: doc.description
  };
}

export default async function DocsArticlePage({ params }: PageProps) {
  const { slug: docSlug } = await params;
  const doc = getDocBySlug(docSlug);

  if (!doc) {
    notFound();
  }

  const sections = getDocsSections();
  const navPages = getDocNav();
  const { prev, next } = getAdjacentDocs(docSlug);

  return (
    <DocsArticleLayout
      title={doc.title}
      description={doc.description}
      lastUpdated={doc.lastUpdated}
      content={doc.content}
      sections={sections}
      navPages={navPages}
      currentSlug={docSlug}
      prev={prev}
      next={next}
      nextStepLinks={nextStepsBySlug[docSlug]}
    />
  );
}
