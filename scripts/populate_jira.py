#!/usr/bin/env python3
"""
Seed a Jira Cloud project with demo tickets aligned to Coop AI Slack demo threads.

Issue keys (COOP-101, etc.) match references in scripts/populate_slack.py so Trace Decision
can resolve Jira context when those keys appear in commits or PR bodies.

Setup:
  1. Jira Cloud site with project key COOP (or set JIRA_PROJECT_KEY).
  2. API token: https://id.atlassian.com/manage-profile/security/api-tokens
  3. cp .env.example .env  # add JIRA_* vars (loaded automatically from scripts/.env)
  4. python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  5. .venv/bin/python populate_jira.py

Coop AI extension: same email + token + site URL in Settings → Decision archaeology.

Usage:
  .venv/bin/python populate_jira.py --dry-run
  .venv/bin/python populate_jira.py --no-align-keys   # skip padding; keys won't match COOP-101
  .venv/bin/python populate_jira.py --tickets 101,118 # seed subset only
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# ---------------------------------------------------------------------------
# Demo tickets — issue number must match Slack references (COOP-<number>).
# ---------------------------------------------------------------------------


@dataclass
class DemoTicket:
    number: int
    summary: str
    issue_type: str
    repos: List[str]  # suffixes under github owner, e.g. coop-ai-core
    description: str
    acceptance_criteria: List[str] = field(default_factory=list)
    labels: List[str] = field(default_factory=list)
    comments: List[str] = field(default_factory=list)
    pr_refs: List[int] = field(default_factory=list)


def demo_tickets() -> List[DemoTicket]:
    return [
        DemoTicket(
            55,
            "Architecture decision: webview vs native sidebar for chat",
            "Story",
            ["coop-ai-core"],
            (
                "Revisit whether the entire Coop chat UI should remain a VS Code webview or move "
                "to a native sidebar tree. Performance is acceptable; pain points are min-width "
                "and keyboard focus inside the webview sandbox."
            ),
            [
                "Document decision outcome in ADR under docs/",
                "Track webview OOM/crash metrics for one release",
            ],
            ["demo", "architecture"],
            [
                "Keeping webview for rapid iteration; invest in coop design tokens instead.",
                "PanelWidthEnforcer hack is acceptable until platform limits hit.",
            ],
        ),
        DemoTicket(
            72,
            "Tech debt: deduplicate OwnershipSignal types",
            "Task",
            ["coop-shared", "coop-ai-core"],
            (
                "`OwnershipSignal` exists in both `coop-shared` and `src/types/ownership.ts`. "
                "Consolidate on `@coop-ai/shared` and remove the extension duplicate."
            ),
            [
                "Publish coop-shared 0.4.0",
                "Extension imports only from shared package",
                "Ownership card branch can merge after types align",
            ],
            ["demo", "technical-debt"],
            ["Blocks merge to main, not local dev."],
        ),
        DemoTicket(
            89,
            "FinServ prospect: full on-prem including LLM routing",
            "Epic",
            ["coop-backend"],
            "Northwind prospect requests full on-prem with Coop-hosted LLM routing. Sales needs a clear pushback position.",
            ["Document what we will not host (our LLM layer)"],
            ["demo", "sales", "on-prem"],
            ["Push back on our LLM hosting; offer VPC backend + BYOK instead."],
        ),
        DemoTicket(
            90,
            "VPC-deployed coop-backend with customer-managed model endpoints",
            "Story",
            ["coop-backend"],
            (
                "Deliverable for enterprise deals: backend in customer AWS, customer-managed "
                "Anthropic/OpenAI keys, extension from marketplace. Helm is out of scope for Q2."
            ),
            [
                "docker-compose + terraform module documented",
                "No Slack/Jira creds stored in Coop cloud for on-prem mode",
            ],
            ["demo", "on-prem"],
            ["Private beta label for first FinServ design partners."],
        ),
        DemoTicket(
            101,
            "Extract auth and repo indexing into coop-backend",
            "Epic",
            ["coop-ai-core", "coop-backend", "platform-api"],
            (
                "Peel auth and GitHub pagination out of the VS Code extension host into `coop-backend`. "
                "Extension should not paginate large monorepos in-process. Acme pilot needs 50k-commit support."
            ),
            [
                "Tokens never leave extension; backend uses short-lived localhost job tickets only",
                "Degraded mode caps history at 2k commits if backend slips a sprint",
                "Threat model reviewed with security",
            ],
            ["demo", "platform"],
            [
                "COOP-108 covers token broker; this epic is service extraction only.",
                "Pilot comms: early warning if we stay on degraded cap.",
            ],
        ),
        DemoTicket(
            108,
            "Token broker for backend jobs (localhost-only)",
            "Story",
            ["coop-backend", "coop-ai-core"],
            "Short-lived job tickets between extension and coop-backend; repo tokens stay in SecretStorage.",
            ["No inbound firewall rules; bind helper to 127.0.0.1 only"],
            ["demo", "security"],
        ),
        DemoTicket(
            118,
            "SSE streaming transport for coop-frontend webview",
            "Story",
            ["coop-web", "coop-ai-core"],
            (
                "Replace chunky postMessage streaming with SSE from a local helper. Split into "
                "118a (transport) and 118b (UX polish). Default-off setting for 0.3."
            ),
            [
                "Random path token in SSE URL so other local processes cannot snoop",
                "Bind to 127.0.0.1:0; pass port via webview state",
                "Ship behind setting default-off for 0.3",
            ],
            ["demo", "frontend"],
            ["PR targets coop-web first — ChatPanel lives there."],
            pr_refs=[118],
        ),
        DemoTicket(
            129,
            "Rollback staging migration 2024_05_add_thread_title",
            "Bug",
            ["coop-backend"],
            "Column already existed from manual hotfix; Flyway migration failed in staging. Prod unchanged.",
            ["Idempotent check before ALTER", "Revoke direct psql for app team — CI-only schema"],
            ["demo", "incident"],
            ["Staging only — no customer impact."],
        ),
        DemoTicket(
            134,
            "Redis cache invalidation for ownership graph on org webhook",
            "Bug",
            ["coop-backend"],
            (
                "Stale ownership maps in staging after GitHub org changes. Cache key `graph:github:ORG/REPO` "
                "not busted on organization webhook."
            ),
            [
                "Listen for organization webhook and delete graph:{repoId}",
                "Reduce TTL to 15m max",
                "Admin CLI: purge graph key without redis-cli",
            ],
            ["demo", "cache"],
            ["Hotfix DEL graph:github:ORG/REPO documented for support."],
        ),
        DemoTicket(
            145,
            "Bitbucket Cloud parity for suggested reviewers / ownership",
            "Story",
            ["coop-ai-core"],
            (
                "Bitbucket lacks GitHub-style suggested reviewers API. Ownership falls back to commit "
                "history only until CODEOWNERS + PR participant ingestion ships."
            ),
            [
                "Document confidence score in UI",
                "sourceAuthority weight adjustment for Bitbucket",
            ],
            ["demo", "bitbucket", "code-host"],
            ["Quality target ~70% of GitHub until Atlassian ships reviewer API."],
        ),
        DemoTicket(
            156,
            "Security review: Slack user token storage in extension",
            "Task",
            ["coop-ai-core"],
            (
                "Users paste Slack user OAuth tokens into settings; stored in VS Code SecretStorage. "
                "OAuth redirect requires coop-ai.dev/oauth/live (not built yet)."
            ),
            [
                "Warn on paste; never log token",
                "Minimum scope copy in UI: search:read, channels:history, groups:history, users:read",
            ],
            ["demo", "security", "slack"],
            ["Approved for MVP with UI scope list."],
        ),
        DemoTicket(
            164,
            "De-flake Slack integration tests (fixtures vs live API)",
            "Task",
            ["coop-ai-core"],
            "Slack integration tests fail ~15% in CI due to search.messages rate limits on real API.",
            [
                "Check in sanitized JSON fixtures for conversations.replies and search.messages",
                "Weekly cron for live test; per-PR uses fixtures",
            ],
            ["demo", "ci"],
        ),
        DemoTicket(
            167,
            "Model routing for decision archaeology (Claude vs GPT)",
            "Story",
            ["coop-ai-core"],
            (
                "Eval: Claude Sonnet best for narrative synthesis; GPT-4o mini 4x cheaper but "
                "hallucinates Jira keys 8% of the time. Default Sonnet for archaeology feature."
            ),
            ["ModelRouter maps decisionArchaeology → configurable with Sonnet default"],
            ["demo", "ml"],
            ["~$420 vs ~$95/month at 1k MAU for archaeology workloads."],
        ),
        DemoTicket(
            175,
            "Jira status stale in trace-decision (webhook lag)",
            "Bug",
            ["coop-ai-core"],
            (
                "Trace Decision showed In Progress while ticket was closed. Jira Cloud webhook delay "
                "up to 10 minutes; manual trace should fresh-fetch issue."
            ),
            [
                "jira.getIssue on trace-decision quick action",
                "Show last synced timestamp on Jira card in timeline",
            ],
            ["demo", "jira"],
        ),
        DemoTicket(
            178,
            "Thread switcher UI in chat header",
            "Story",
            ["coop-web", "coop-ai-core"],
            "Figma designs for thread dropdown in chat header. chatThreadStore exists on extension side.",
            [
                "Migrate in-memory threads to workspace storage with backwards compat",
                "Auto-title on first message ships in v1",
            ],
            ["demo", "ux"],
            ["~3d UI + 2d persistence + 1d migration."],
        ),
        DemoTicket(
            188,
            "Degradation banner stays after Slack reconnects",
            "Bug",
            ["coop-ai-core"],
            (
                "Amber degradation banner not cleared when Slack returns healthy. "
                "Unavailable provider list updates but sticky banner state does not."
            ),
            [
                "Clear banner when slack removed from unavailableProviders",
                "Copy: Slack context temporarily limited + bullets for what still works",
            ],
            ["demo", "ux"],
        ),
        DemoTicket(
            192,
            "Normalize Slack thread URLs with redirect follow",
            "Story",
            ["coop-ai-core"],
            "PR #342 adds Slack permalink parsing for decision archaeology. Archive redirect URLs lacked team ID.",
            ["slackClient.parseSlackThreadUrl follows redirect once"],
            ["demo", "slack"],
            pr_refs=[342],
        ),
        DemoTicket(
            198,
            "Shared prompt library via .coop/prompts.json in repo",
            "Story",
            ["coop-ai-core", "coop-backend"],
            "Team-shared prompts: start with repo file; backend sync deferred to COOP-199.",
            [
                "Import/export in Prompt Library modal",
                "Respect .coopignore for paths that must not upload",
            ],
            ["demo", "prompts"],
        ),
        DemoTicket(
            201,
            "Ownership graph timeout on large repos (legacy-payments)",
            "Bug",
            ["coop-ai-core", "coop-backend"],
            (
                "12k contributors / 400k commits — blame sweep O(n) times out at 30s. "
                "Customer repo legacy-payments."
            ),
            [
                "Incremental graph with since cursor in workspace state",
                "Stream top 10 owners immediately; badge refining until worker completes",
                "Worker queue respects repo scope — no cross-repo leakage",
            ],
            ["demo", "performance"],
            ["Long term: graph build on coop-backend worker queue."],
        ),
        DemoTicket(
            210,
            "Slack search.messages rate limits for decision archaeology",
            "Story",
            ["coop-ai-core"],
            "User token ~20/min; archaeology bursts ~5 queries per trace. Need cache + backoff.",
            [
                "Cache recent searches in extension globalState",
                "User-visible try again in 30s",
                "DM search stays opt-in off by default",
            ],
            ["demo", "slack", "scale"],
        ),
        DemoTicket(
            219,
            "Null thread_ts on single-message Slack threads (bot seeded)",
            "Bug",
            ["coop-ai-core"],
            "conversations.replies omits thread_ts when parent ts equals thread ts on bot-only threads.",
            ["Treat first message ts as thread anchor", "Unit test with populate_slack fixture output"],
            ["demo", "slack"],
        ),
        DemoTicket(
            225,
            "Release blocker: VS Code marketplace review timeline",
            "Task",
            ["coop-ai-core"],
            "Marketplace review 5–7 days. Must submit Thursday for May window.",
            [
                "Slack token help text in settings",
                "Thread persistence P0 merged — not cosmetic card polish",
            ],
            ["demo", "release"],
            ["Cut 0.3.0 RC after Slack + Jira demo seed validates archaeology E2E."],
        ),
    ]


# ---------------------------------------------------------------------------
# Jira REST client (stdlib only)
# ---------------------------------------------------------------------------


class JiraClient:
    def __init__(self, base_url: str, email: str, api_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_base = f"{self.base_url}/rest/api/3"
        import base64

        creds = base64.b64encode(f"{email}:{api_token}".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {creds}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = path if path.startswith("http") else f"{self.api_base}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = Request(url, data=data, headers=self.headers, method=method)
        try:
            with urlopen(req, timeout=60) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except HTTPError as e:
            detail = e.read().decode()
            raise RuntimeError(f"Jira HTTP {e.code} {method} {path}: {detail}") from e

    def myself(self) -> Dict[str, Any]:
        return self._request("GET", "/myself")

    def project(self, key: str) -> Dict[str, Any]:
        return self._request("GET", f"/project/{key}")

    def issue_exists(self, key: str) -> bool:
        try:
            self._request("GET", f"/issue/{key}?fields=summary")
            return True
        except RuntimeError as e:
            if "404" in str(e):
                return False
            raise

    def max_issue_number(self, project_key: str) -> int:
        """Highest numeric suffix among existing issues (0 if none)."""
        jql = f'project = "{project_key}"'
        max_num = 0
        start_at = 0
        while True:
            payload = {
                "jql": jql,
                "maxResults": 100,
                "startAt": start_at,
                "fields": ["key"],
            }
            result = self._request("POST", "/search", payload)
            issues = result.get("issues") or []
            for issue in issues:
                key = issue.get("key", "")
                m = re.match(rf"^{re.escape(project_key)}-(\d+)$", key, re.I)
                if m:
                    max_num = max(max_num, int(m.group(1)))
            total = result.get("total", 0)
            start_at += len(issues)
            if start_at >= total or not issues:
                break
        return max_num

    def resolve_issue_type(self, project_key: str, preferred: str) -> str:
        meta = self._request(
            "GET",
            f"/issue/createmeta?projectKeys={project_key}&expand=projects.issuetypes",
        )
        types: List[str] = []
        for proj in meta.get("projects") or []:
            for it in proj.get("issuetypes") or []:
                name = it.get("name")
                if name:
                    types.append(name)
        if preferred in types:
            return preferred
        for fallback in ("Story", "Task", "Bug", "Epic"):
            if fallback in types:
                return fallback
        return types[0] if types else "Task"

    def create_issue(
        self,
        project_key: str,
        summary: str,
        description_adf: Dict[str, Any],
        issue_type: str,
        labels: List[str],
    ) -> str:
        resolved_type = self.resolve_issue_type(project_key, issue_type)
        fields: Dict[str, Any] = {
            "project": {"key": project_key},
            "summary": summary,
            "description": description_adf,
            "issuetype": {"name": resolved_type},
        }
        if labels:
            fields["labels"] = labels
        result = self._request("POST", "/issue", {"fields": fields})
        return result["key"]

    def add_comment(self, issue_key: str, text: str) -> None:
        body = adf_doc(text)
        self._request("POST", f"/issue/{issue_key}/comment", {"body": body})


# ---------------------------------------------------------------------------
# ADF helpers
# ---------------------------------------------------------------------------


def adf_paragraph(text: str) -> Dict[str, Any]:
    return {
        "type": "paragraph",
        "content": [{"type": "text", "text": text}],
    }


def adf_heading(text: str, level: int = 3) -> Dict[str, Any]:
    return {
        "type": "heading",
        "attrs": {"level": level},
        "content": [{"type": "text", "text": text}],
    }


def adf_bullet_list(items: Sequence[str]) -> Dict[str, Any]:
    return {
        "type": "bulletList",
        "content": [
            {
                "type": "listItem",
                "content": [adf_paragraph(item)],
            }
            for item in items
        ],
    }


def adf_doc(*blocks: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "doc", "version": 1, "content": list(blocks)}


def build_description(
    ticket: DemoTicket,
    repo_ids: List[str],
    github_owner: str,
) -> Dict[str, Any]:
    blocks: List[Dict[str, Any]] = [
        adf_paragraph(ticket.description),
        adf_heading("Repositories"),
    ]
    repo_lines = repo_ids or [f"github:{github_owner}/(none)"]
    blocks.append(adf_bullet_list(repo_lines))

    if ticket.pr_refs:
        blocks.append(adf_heading("Pull requests"))
        blocks.append(
            adf_bullet_list([f"#{n} — see github:{github_owner}/{ticket.repos[0] if ticket.repos else 'coop-ai-core'}" for n in ticket.pr_refs])
        )

    if ticket.acceptance_criteria:
        blocks.append(adf_heading("Acceptance criteria"))
        blocks.append(adf_bullet_list(ticket.acceptance_criteria))

    blocks.append(
        adf_paragraph(
            "Seeded by scripts/populate_jira.py for Coop AI demo / Trace Decision. "
            "Do not use for production tracking."
        )
    )
    return adf_doc(*blocks)


def expand_repos(suffixes: List[str], github_owner: str) -> List[str]:
    return [f"github:{github_owner}/{s}" for s in suffixes]


# ---------------------------------------------------------------------------
# Seeder
# ---------------------------------------------------------------------------


@dataclass
class Config:
    base_url: str
    email: str
    api_token: str
    project_key: str
    github_owner: str
    align_keys: bool
    dry_run: bool
    delay_sec: float
    ticket_filter: Optional[set[int]]


def load_dotenv_file() -> None:
    """Load scripts/.env into os.environ (does not override variables already set)."""
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


def load_config(args: argparse.Namespace) -> Config:
    load_dotenv_file()
    base_url = os.environ.get("JIRA_BASE_URL", "").strip()
    email = os.environ.get("JIRA_EMAIL", "").strip()
    api_token = os.environ.get("JIRA_API_TOKEN", "").strip()
    project_key = os.environ.get("JIRA_PROJECT_KEY", "COOP").strip().upper()
    github_owner = os.environ.get("JIRA_DEMO_GITHUB_OWNER", "coop-ai").strip()

    missing = [n for n, v in [("JIRA_BASE_URL", base_url), ("JIRA_EMAIL", email), ("JIRA_API_TOKEN", api_token)] if not v]
    if missing:
        print(f"Missing env: {', '.join(missing)}", file=sys.stderr)
        print("Edit scripts/.env (see .env.example) with JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.", file=sys.stderr)
        sys.exit(1)

    ticket_filter = None
    if args.tickets:
        ticket_filter = {int(x.strip()) for x in args.tickets.split(",") if x.strip()}

    return Config(
        base_url=base_url,
        email=email,
        api_token=api_token,
        project_key=project_key,
        github_owner=github_owner,
        align_keys=not args.no_align_keys,
        dry_run=args.dry_run,
        delay_sec=float(os.environ.get("JIRA_DELAY_SEC", "0.4")),
        ticket_filter=ticket_filter,
    )


def pad_to_number(
    client: JiraClient,
    cfg: Config,
    target_number: int,
    current_next: int,
) -> int:
    """Create placeholder issues until the next issue will be PROJECT-target_number."""
    while current_next < target_number:
        key = f"{cfg.project_key}-{current_next}"
        if not cfg.dry_run and client.issue_exists(key):
            current_next += 1
            continue
        summary = f"[Coop demo padding] Placeholder {current_next}"
        if cfg.dry_run:
            print(f"  [dry-run] pad {key}: {summary}")
        else:
            adf = adf_doc(
                adf_paragraph("Auto-created so demo tickets align with Slack COOP-* references."),
            )
            client.create_issue(cfg.project_key, summary, adf, "Task", ["demo-padding"])
            print(f"  padded {key}")
            time.sleep(cfg.delay_sec)
        current_next += 1
    return current_next


def seed_ticket(client: JiraClient, cfg: Config, ticket: DemoTicket) -> None:
    key = f"{cfg.project_key}-{ticket.number}"
    if not cfg.dry_run and client.issue_exists(key):
        print(f"  skip {key} (already exists)")
        return

    repo_ids = expand_repos(ticket.repos, cfg.github_owner)
    labels = list(dict.fromkeys(["coop-demo", *ticket.labels]))
    description = build_description(ticket, repo_ids, cfg.github_owner)

    if cfg.dry_run:
        print(f"  [dry-run] create {key}: {ticket.summary}")
        print(f"            repos: {', '.join(repo_ids)}")
        return

    created_key = client.create_issue(
        cfg.project_key,
        ticket.summary,
        description,
        ticket.issue_type,
        labels,
    )
    if created_key.upper() != key.upper():
        print(f"  WARN: expected {key}, got {created_key} — update Slack or re-run with --align-keys on empty project")
        key = created_key
    else:
        print(f"  created {key}: {ticket.summary}")

    for comment in ticket.comments:
        client.add_comment(key, comment)
        time.sleep(cfg.delay_sec * 0.5)

    time.sleep(cfg.delay_sec)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Jira demo tickets for Coop AI")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without API writes")
    parser.add_argument(
        "--no-align-keys",
        action="store_true",
        help="Do not pad with placeholder issues (keys will be COOP-1..N on empty project)",
    )
    parser.add_argument(
        "--tickets",
        metavar="N,N",
        help="Comma-separated issue numbers only (e.g. 101,118,175)",
    )
    args = parser.parse_args()
    cfg = load_config(args)

    tickets = demo_tickets()
    if cfg.ticket_filter:
        tickets = [t for t in tickets if t.number in cfg.ticket_filter]
    tickets.sort(key=lambda t: t.number)

    print(f"Jira: {cfg.base_url}  project={cfg.project_key}  github_owner={cfg.github_owner}")
    print(f"Tickets to seed: {len(tickets)}  align_keys={cfg.align_keys}  dry_run={cfg.dry_run}")

    client = JiraClient(cfg.base_url, cfg.email, cfg.api_token)

    if not cfg.dry_run:
        user = client.myself()
        print(f"Authenticated as: {user.get('displayName', user.get('emailAddress', '?'))}")
        client.project(cfg.project_key)

    if cfg.align_keys:
        next_num = 1 if cfg.dry_run else client.max_issue_number(cfg.project_key) + 1
        print(f"Next issue number in project: {next_num}")
        for ticket in tickets:
            if cfg.align_keys:
                next_num = pad_to_number(client, cfg, ticket.number, next_num)
            seed_ticket(client, cfg, ticket)
            next_num = ticket.number + 1
    else:
        for ticket in tickets:
            seed_ticket(client, cfg, ticket)

    print("Done.")
    if cfg.dry_run:
        print("\nDry-run only. Run without --dry-run to create issues (may take several minutes).")
    else:
        print(
            f"\nVerify in Coop AI: Trace Decision on a commit mentioning {cfg.project_key}-101 "
            f"(repos under github:{cfg.github_owner}/...)."
        )


if __name__ == "__main__":
    main()
