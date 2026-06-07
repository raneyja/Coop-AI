#!/usr/bin/env python3
"""
Seed a Confluence Cloud space with demo pages for Coop AI integration testing.

Pages include github:owner/repo references so Coop AI's CQL search
(buildConfluenceCql in src/context/docSearchQuery.ts) finds them when you
run /confluence, ask about wiki docs, or test Knowledge Gaps.

Setup:
  1. Atlassian Cloud site (free dev bundle includes Confluence):
     https://www.atlassian.com/try/cloud/signup?developer=true
  2. API token: https://id.atlassian.com/manage-profile/security/api-tokens
     Use a classic token (no scopes) so requests go to your site URL directly.
  3. cp .env.example .env  # add CONFLUENCE_* or reuse JIRA_* vars
  4. python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  5. .venv/bin/python populate_confluence.py

Coop AI extension: same email + token in Settings → Integrations → Confluence.
Site URL: https://your-domain.atlassian.net/wiki

Usage:
  .venv/bin/python populate_confluence.py --dry-run
  .venv/bin/python populate_confluence.py --pages architecture,onboarding
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

# ---------------------------------------------------------------------------
# Demo pages — body must mention repo search terms for CQL text search.
# ---------------------------------------------------------------------------


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
            slug="architecture",
            title="Coop AI — Architecture Overview",
            repos=["coop-ai-core"],
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
                    "Coop backend (optional): LLM routing, webhooks, org API when not fully local.",
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
            repos=["coop-ai-core", "coop-backend"],
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
            repos=["coop-ai-core"],
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
                    "Settings → Integrations. Demo seeders live in scripts/populate_*.py.",
                ),
            ],
            labels=["demo", "onboarding"],
        ),
        DemoPage(
            slug="integrations",
            title="Integrations — Slack, Jira, Confluence",
            repos=["coop-ai-core"],
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
            repos=["coop-ai-core"],
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


# ---------------------------------------------------------------------------
# Confluence REST client
# ---------------------------------------------------------------------------


class ConfluenceClient:
    def __init__(self, wiki_base: str, email: str, api_token: str) -> None:
        self.wiki_base = wiki_base.rstrip("/")
        if not self.wiki_base.endswith("/wiki"):
            self.wiki_base = f"{self.wiki_base}/wiki"
        self.api_base = f"{self.wiki_base}/rest/api"
        encoded = __import__("base64").b64encode(f"{email}:{api_token}".encode()).decode()
        self.auth_header = f"Basic {encoded}"

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, str]] = None,
    ) -> Any:
        url = f"{self.api_base}{path}"
        if query:
            params = "&".join(f"{quote(k)}={quote(v)}" for k, v in query.items())
            url = f"{url}?{params}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": self.auth_header,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(req, timeout=60) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except HTTPError as e:
            detail = e.read().decode()
            raise RuntimeError(f"Confluence HTTP {e.code} {method} {path}: {detail}") from e

    def current_user(self) -> Dict[str, Any]:
        return self._request("GET", "/user/current")

    def space_exists(self, key: str) -> bool:
        try:
            self._request("GET", f"/space/{key}")
            return True
        except RuntimeError as e:
            if "404" in str(e):
                return False
            raise

    def create_space(self, key: str, name: str, description: str) -> None:
        self._request(
            "POST",
            "/space",
            {
                "key": key,
                "name": name,
                "description": {
                    "plain": {
                        "value": description,
                        "representation": "plain",
                    }
                },
            },
        )

    def find_page_by_title(self, space_key: str, title: str) -> Optional[str]:
        cql = f'space="{space_key}" AND type=page AND title="{title.replace(chr(34), chr(92)+chr(34))}"'
        result = self._request("GET", "/content/search", query={"cql": cql, "limit": "1"})
        results = result.get("results") or []
        if not results:
            return None
        return results[0].get("id")

    def create_page(
        self,
        space_key: str,
        title: str,
        storage_html: str,
        parent_id: Optional[str] = None,
    ) -> str:
        body: Dict[str, Any] = {
            "type": "page",
            "title": title,
            "space": {"key": space_key},
            "body": {
                "storage": {
                    "value": storage_html,
                    "representation": "storage",
                }
            },
        }
        if parent_id:
            body["ancestors"] = [{"id": parent_id}]
        result = self._request("POST", "/content", body)
        return result["id"]

    def update_page(
        self,
        page_id: str,
        title: str,
        storage_html: str,
        version: int,
    ) -> None:
        self._request(
            "PUT",
            f"/content/{page_id}",
            {
                "type": "page",
                "title": title,
                "body": {
                    "storage": {
                        "value": storage_html,
                        "representation": "storage",
                    }
                },
                "version": {"number": version + 1},
            },
        )

    def get_page(self, page_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/content/{page_id}", query={"expand": "body.storage,version"})


# ---------------------------------------------------------------------------
# HTML body builder
# ---------------------------------------------------------------------------


def repo_refs(repos: Sequence[str], github_owner: str) -> List[str]:
    refs: List[str] = []
    for suffix in repos:
        refs.append(f"github:{github_owner}/{suffix}")
        refs.append(f"{github_owner}/{suffix}")
        refs.append(suffix)
    return list(dict.fromkeys(refs))


def build_storage_html(page: DemoPage, github_owner: str) -> str:
    refs = repo_refs(page.repos, github_owner)
    parts: List[str] = [
        "<p><strong>Repositories covered:</strong></p>",
        "<ul>",
    ]
    for ref in refs:
        parts.append(f"<li><code>{html.escape(ref)}</code></li>")
    parts.append("</ul>")

    for heading, body in page.sections:
        parts.append(f"<h2>{html.escape(heading)}</h2>")
        for paragraph in body.split("\n\n"):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            if "\n" in paragraph:
                parts.append("<ul>")
                for line in paragraph.split("\n"):
                    line = line.strip()
                    if line:
                        parts.append(f"<li>{html.escape(line)}</li>")
                parts.append("</ul>")
            else:
                parts.append(f"<p>{html.escape(paragraph)}</p>")

    if page.labels:
        parts.append(
            f"<p><em>Labels: {html.escape(', '.join(page.labels))}. "
            "Seeded by scripts/populate_confluence.py for Coop AI demo — not production docs.</em></p>"
        )

    return "".join(parts)


# ---------------------------------------------------------------------------
# Seeder
# ---------------------------------------------------------------------------


@dataclass
class Config:
    wiki_base: str
    email: str
    api_token: str
    space_key: str
    space_name: str
    github_owner: str
    dry_run: bool
    delay_sec: float
    page_filter: Optional[set[str]]
    update_existing: bool


def load_dotenv_file() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def resolve_config_value(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


def load_config(args: argparse.Namespace) -> Config:
    load_dotenv_file()

    site_url = resolve_config_value("CONFLUENCE_BASE_URL", "JIRA_BASE_URL")
    email = resolve_config_value("CONFLUENCE_EMAIL", "JIRA_EMAIL")
    api_token = resolve_config_value("CONFLUENCE_API_TOKEN", "JIRA_API_TOKEN")
    space_key = resolve_config_value("CONFLUENCE_SPACE_KEY", default="COOP").upper()
    space_name = resolve_config_value("CONFLUENCE_SPACE_NAME", default="Coop AI Demo")
    github_owner = resolve_config_value(
        "CONFLUENCE_DEMO_GITHUB_OWNER", "JIRA_DEMO_GITHUB_OWNER", default="coop-ai"
    )

    wiki_base = site_url.rstrip("/")
    if wiki_base and not wiki_base.endswith("/wiki"):
        wiki_base = f"{wiki_base}/wiki"

    missing = [
        name
        for name, value in [
            ("CONFLUENCE_BASE_URL or JIRA_BASE_URL", site_url),
            ("CONFLUENCE_EMAIL or JIRA_EMAIL", email),
            ("CONFLUENCE_API_TOKEN or JIRA_API_TOKEN", api_token),
        ]
        if not value
    ]
    if missing:
        print(f"Missing env: {', '.join(missing)}", file=sys.stderr)
        print("Edit scripts/.env (see .env.example).", file=sys.stderr)
        sys.exit(1)

    page_filter = None
    if args.pages:
        page_filter = {x.strip().lower() for x in args.pages.split(",") if x.strip()}

    return Config(
        wiki_base=wiki_base,
        email=email,
        api_token=api_token,
        space_key=space_key,
        space_name=space_name,
        github_owner=github_owner,
        dry_run=args.dry_run,
        delay_sec=float(os.environ.get("CONFLUENCE_DELAY_SEC", "0.5")),
        page_filter=page_filter,
        update_existing=args.update_existing,
    )


def ensure_space(client: ConfluenceClient, cfg: Config) -> None:
    if cfg.dry_run:
        print(f"  [dry-run] ensure space {cfg.space_key}: {cfg.space_name}")
        return
    if client.space_exists(cfg.space_key):
        print(f"  space {cfg.space_key} exists")
        return
    client.create_space(
        cfg.space_key,
        cfg.space_name,
        "Demo documentation for Coop AI Confluence integration testing.",
    )
    print(f"  created space {cfg.space_key}: {cfg.space_name}")
    time.sleep(cfg.delay_sec)


def seed_page(client: ConfluenceClient, cfg: Config, page: DemoPage, parent_id: Optional[str]) -> Optional[str]:
    storage = build_storage_html(page, cfg.github_owner)
    existing_id = None if cfg.dry_run else client.find_page_by_title(cfg.space_key, page.title)

    if existing_id and not cfg.update_existing:
        print(f"  skip {page.slug} (page exists: {page.title})")
        return existing_id

    if cfg.dry_run:
        refs = ", ".join(repo_refs(page.repos, cfg.github_owner))
        print(f"  [dry-run] {page.slug}: {page.title}")
        print(f"            refs: {refs}")
        return None

    if existing_id and cfg.update_existing:
        current = client.get_page(existing_id)
        version = current.get("version", {}).get("number", 1)
        client.update_page(existing_id, page.title, storage, version)
        print(f"  updated {page.slug}: {page.title}")
        time.sleep(cfg.delay_sec)
        return existing_id

    page_id = client.create_page(cfg.space_key, page.title, storage, parent_id)
    print(f"  created {page.slug}: {page.title}")
    time.sleep(cfg.delay_sec)
    return page_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Confluence demo pages for Coop AI")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without API writes")
    parser.add_argument(
        "--pages",
        metavar="SLUG,SLUG",
        help="Comma-separated page slugs only (architecture, backend-extraction, ...)",
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="Update pages that already exist (default: skip)",
    )
    args = parser.parse_args()
    cfg = load_config(args)

    pages = demo_pages()
    if cfg.page_filter:
        pages = [p for p in pages if p.slug in cfg.page_filter]

    print(f"Confluence: {cfg.wiki_base}  space={cfg.space_key}  github_owner={cfg.github_owner}")
    print(f"Pages to seed: {len(pages)}  dry_run={cfg.dry_run}")

    client = ConfluenceClient(cfg.wiki_base, cfg.email, cfg.api_token)

    if not cfg.dry_run:
        user = client.current_user()
        print(f"Authenticated as: {user.get('displayName', user.get('email', '?'))}")

    ensure_space(client, cfg)

    parent_id: Optional[str] = None
    for page in pages:
        if page.slug == "architecture":
            parent_id = seed_page(client, cfg, page, None)
        else:
            seed_page(client, cfg, page, parent_id)

    print("Done.")
    if cfg.dry_run:
        print("\nDry-run only. Run without --dry-run to create pages.")
    else:
        sample_repo = pages[0].repos[0] if pages else "coop-ai-core"
        print(
            f"\nVerify in Coop AI:\n"
            f"  1. Settings → Integrations → Confluence: site URL, email, API token → Test Confluence\n"
            f"  2. Set repo owner={cfg.github_owner}, repo={sample_repo} in Settings → Repository\n"
            f"  3. Chat: /confluence what architecture docs exist?\n"
            f"     or: any confluence pages for this repo?"
        )


if __name__ == "__main__":
    main()
