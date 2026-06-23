"""Shared demo documentation pages for Confluence and Google Docs seeders."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


@dataclass
class DemoPage:
    slug: str
    title: str
    repos: List[str]  # suffixes under github owner, e.g. coop-ai-core
    sections: List[tuple[str, str]] = field(default_factory=list)
    labels: List[str] = field(default_factory=list)


def demo_pages() -> List[DemoPage]:
    return [
        DemoPage(
            slug="github-app-api",
            title="GitHub App API — server routes",
            repos=["Coop-AI"],
            sections=[
                (
                    "Overview",
                    "src/server/githubAppApi.ts registers HTTP handlers for GitHub App installation, "
                    "installation access tokens, and OAuth callback flows used by the Coop backend.",
                ),
                (
                    "Related code",
                    "githubAppService.ts — GitHub App JWT and installation token exchange.\n"
                    "githubAppConfig.ts — GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY resolution.\n"
                    "githubOAuthService.ts — GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.",
                ),
                (
                    "Operations",
                    "See docs/webhook-backend.md for local docker-compose. "
                    "Org-level Connect in Settings uses these routes when coopAI.devMode is false.",
                ),
            ],
            labels=["demo", "github", "api"],
        ),
        DemoPage(
            slug="architecture",
            title="Coop AI — Architecture Overview",
            repos=["Coop-AI", "coop-ai-core"],
            sections=[
                (
                    "Summary",
                    "Coop AI is a VS Code extension that surfaces repository context, "
                    "decision archaeology, and quick actions (Trace Decision, Understand Repo, "
                    "Blast Radius) from the sidebar webview.",
                ),
                (
                    "Key components",
                    "Extension host (TypeScript): context gathering, integrations, chat session.\n"
                    "Webview (React): chat UI, settings, quick actions.\n"
                    "Coop backend (optional): LLM routing, webhooks, org API when not fully local.\n"
                    "Server routes: src/server/githubAppApi.ts for GitHub App and OAuth callbacks.",
                ),
                (
                    "Related work",
                    "See COOP-101 for extracting auth and repo indexing into coop-backend. "
                    "COOP-55 tracks the webview vs native sidebar ADR.",
                ),
            ],
            labels=["demo", "architecture"],
        ),
        DemoPage(
            slug="backend-extraction",
            title="ADR: Backend service extraction (COOP-101)",
            repos=["Coop-AI", "coop-ai-core", "coop-backend"],
            sections=[
                (
                    "Context",
                    "GitHub pagination and repo indexing currently run in the VS Code extension host. "
                    "Large monorepos hit memory and latency limits during Understand Repo and Trace Decision.",
                ),
                (
                    "Decision",
                    "Extract auth, repo indexing, and webhook ingestion into coop-backend. "
                    "Extension calls the backend over HTTPS; degraded mode keeps in-process path "
                    "with a 2k commit cap when backend is unreachable.",
                ),
                (
                    "Status",
                    "In progress — docker-compose and local dev documented under docs/webhook-backend.md.",
                ),
            ],
            labels=["demo", "adr", "coop-101"],
        ),
        DemoPage(
            slug="onboarding",
            title="Developer onboarding — VS Code extension",
            repos=["Coop-AI", "coop-ai-core"],
            sections=[
                (
                    "Prerequisites",
                    "Node 20+, VS Code 1.85+, Docker (optional, for local backend).",
                ),
                (
                    "Local dev",
                    "npm install && npm run compile. Press F5 to launch Extension Development Host. "
                    "Set Coop API base URL to http://localhost:8787 when running docker-compose.",
                ),
                (
                    "Integrations",
                    "Configure GitHub PAT, Slack user token, and Jira/Confluence API tokens in "
                    "Settings → Tools. Demo seeders live in scripts/populate_*.py.",
                ),
            ],
            labels=["demo", "onboarding"],
        ),
        DemoPage(
            slug="integrations",
            title="Integrations — Slack, Jira, Confluence, Notion, Google Docs",
            repos=["Coop-AI", "coop-ai-core"],
            sections=[
                (
                    "Slack",
                    "User OAuth token (xoxp-) with search:read and channels:history. "
                    "Used by Trace Decision to pull threads linked to PRs and Jira keys.",
                ),
                (
                    "Jira",
                    "Atlassian API token + site URL. Demo tickets COOP-101, COOP-118 seeded by populate_jira.py.",
                ),
                (
                    "Confluence",
                    "Same Atlassian account as Jira. Coop searches pages with CQL text ~ repo name "
                    "and github:owner/repo. Use /confluence in chat or ask about wiki documentation.",
                ),
                (
                    "Notion",
                    "Internal integration token (secret_) or Connect in production. "
                    "Coop searches page titles and bodies via the Notion search API using repo name "
                    "and github:owner/repo. Use /notion in chat.",
                ),
                (
                    "Google Docs",
                    "OAuth access token with drive.readonly (or Connect in production). "
                    "Coop searches document bodies with Drive fullText contains repo name "
                    "and github:owner/repo. Use /google-docs in chat.",
                ),
            ],
            labels=["demo", "integrations"],
        ),
        DemoPage(
            slug="enterprise",
            title="Enterprise deployment — VPC and BYOK",
            repos=["coop-backend"],
            sections=[
                (
                    "Overview",
                    "FinServ prospects request full on-prem including LLM routing (COOP-89). "
                    "Approved pattern: VPC-deployed coop-backend with customer-managed model keys (COOP-90).",
                ),
                (
                    "Out of scope",
                    "Coop-hosted LLM layer in customer VPC. Helm charts deferred past Q2.",
                ),
                (
                    "Deliverables",
                    "docker-compose, terraform module, zero-retention LLM docs. "
                    "No Slack/Jira credentials stored in Coop cloud for on-prem mode.",
                ),
            ],
            labels=["demo", "enterprise", "on-prem"],
        ),
        DemoPage(
            slug="webview-adr",
            title="ADR: Webview vs native sidebar (COOP-55)",
            repos=["Coop-AI", "coop-ai-core"],
            sections=[
                (
                    "Problem",
                    "Chat UI runs in a VS Code webview. Pain points: min-width constraints, "
                    "keyboard focus inside the sandbox, occasional OOM on long sessions.",
                ),
                (
                    "Decision",
                    "Keep webview for rapid iteration; invest in coop design tokens and PanelWidthEnforcer "
                    "instead of migrating to a native TreeView this quarter.",
                ),
                (
                    "Follow-up",
                    "Track webview crash metrics for one release. Revisit if platform limits block enterprise pilots.",
                ),
            ],
            labels=["demo", "adr", "coop-55"],
        ),
    ]
