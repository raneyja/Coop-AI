import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BreadcrumbSchema } from "@/components/BreadcrumbSchema";
import { DocsArticleLayout } from "@/components/DocsArticleLayout";
import { FaqPageSchema } from "@/components/FaqPageSchema";
import { getAdjacentDocs, getAllDocs, getDocBySlug, getDocNav, getDocsSections } from "@/lib/docs";
import { extractFaqPairs } from "@/lib/faqSchema";
import { buildPageMetadata } from "@/lib/pageMetadata";

const nextStepsBySlug: Record<string, { href: string; label: string }[]> = {
  "getting-started": [
    { href: "/docs/what-is-coopai", label: "What is CoopAI?" },
    { href: "/how-it-works", label: "How CoopAI works" },
    { href: "/docs/install-extension", label: "Install the VS Code extension" },
    { href: "/docs/extension-settings", label: "Extension settings reference" },
    { href: "/manual#quick-actions", label: "Quick actions in the Owner's Manual" }
  ],
  "what-is-coopai": [
    { href: "/how-it-works", label: "How CoopAI works" },
    { href: "/docs/compare", label: "Compare CoopAI" },
    { href: "/docs/getting-started", label: "Getting started" }
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
    { href: "/docs/sso", label: "Configure SAML SSO" },
    { href: "/docs/integration-scope", label: "Configure integration scope" }
  ],
  "connect-integrations": [
    { href: "/docs/github", label: "GitHub setup" },
    { href: "/docs/slack", label: "Slack setup" },
    { href: "/docs/teams", label: "Microsoft Teams setup" }
  ],
  "integration-scope": [
    { href: "/docs/admin-portal", label: "Admin portal overview" },
    { href: "/docs/troubleshooting", label: "Troubleshooting" }
  ],
  "edit-mode": [
    { href: "/docs/create-pull-request", label: "Create a pull request from chat or the patch card" },
    { href: "/manual#create-a-pull-request", label: "Owner's Manual — Create a pull request" }
  ],
  "create-pull-request": [
    { href: "/docs/edit-mode", label: "Edit mode — generate and apply patches" },
    { href: "/manual#create-a-pull-request", label: "Owner's Manual — Create a pull request" }
  ],
  "github": [
    { href: "/docs/connect-integrations", label: "Integration overview" },
    { href: "/docs/create-pull-request", label: "Create a pull request from Coop" }
  ],
  "slack": [{ href: "/docs/integration-scope", label: "Slack scope configuration" }],
  "teams": [{ href: "/docs/connect-integrations", label: "Integration overview" }],
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
    { href: "/docs/sso", label: "Single Sign On (SSO)" },
    { href: "/docs/zero-retention", label: "Zero-retention configuration" }
  ],
  "sso": [
    { href: "/docs/saml-sso-troubleshooting", label: "SAML SSO troubleshooting" },
    { href: "/enterprise", label: "Enterprise product page" },
    { href: "/security", label: "Security overview" }
  ],
  "zero-retention": [{ href: "/docs/enterprise-deployment", label: "Enterprise deployment" }],
  "enterprise-deployment": [
    { href: "/docs/sso", label: "Configure SAML SSO" },
    { href: "/docs/security-architecture", label: "Security architecture" },
    { href: "/enterprise", label: "Enterprise product page" }
  ],
  troubleshooting: [{ href: "/docs/faq", label: "Frequently asked questions" }],
  faq: [
    { href: "/docs/compare", label: "Compare CoopAI" },
    { href: "/how-it-works", label: "How CoopAI works" },
    { href: "/demo", label: "Contact support" }
  ],
  compare: [
    { href: "/docs/what-is-coopai", label: "What is CoopAI?" },
    { href: "/docs/compare-github-copilot", label: "CoopAI vs GitHub Copilot" },
    { href: "/docs/compare-cursor", label: "CoopAI vs Cursor" },
    { href: "/how-it-works", label: "How CoopAI works" }
  ],
  "compare-github-copilot": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-cursor", label: "CoopAI vs Cursor" },
    { href: "/how-it-works", label: "How CoopAI works" }
  ],
  "compare-cursor": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-claude-code", label: "CoopAI vs Claude Code" },
    { href: "/how-it-works", label: "How CoopAI works" }
  ],
  "compare-sourcegraph-cody": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-sourcegraph-deep-search", label: "CoopAI vs Deep Search" }
  ],
  "compare-sourcegraph-deep-search": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-sourcegraph-cody", label: "CoopAI vs Cody" }
  ],
  "compare-claude-code": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-claude", label: "CoopAI vs Claude" }
  ],
  "compare-claude": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-chatgpt", label: "CoopAI vs ChatGPT" }
  ],
  "compare-chatgpt": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-codex", label: "CoopAI vs Codex" }
  ],
  "compare-codex": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-augment", label: "CoopAI vs Augment" }
  ],
  "compare-augment": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-ampcode", label: "CoopAI vs Ampcode" }
  ],
  "compare-ampcode": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-perplexity", label: "CoopAI vs Perplexity" }
  ],
  "compare-perplexity": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/docs/compare-grok", label: "CoopAI vs Grok" }
  ],
  "compare-grok": [
    { href: "/docs/compare", label: "All comparisons" },
    { href: "/how-it-works", label: "How CoopAI works" }
  ]
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

  return buildPageMetadata(`/docs/${slug}`, doc.title, doc.description ?? doc.title);
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
  const faqPairs =
    docSlug === "faq" || docSlug === "what-is-coopai" || docSlug === "compare"
      ? extractFaqPairs(doc.content)
      : [];

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Documentation", href: "/docs" },
          { name: doc.title, href: `/docs/${docSlug}` }
        ]}
      />
      {faqPairs.length > 0 ? <FaqPageSchema pairs={faqPairs} /> : null}
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
    </>
  );
}
