#!/usr/bin/env python3
"""
Seed Slack, Jira, Confluence, and Google Docs for the Java monolith dogfood sheet.

Ground truth aliases:
  COOP-401  SQL injection in customers.jsp — extract to CustomerDAO
  COOP-402  JDBC connection leaks in JSPs vs ConnectionManager
  COOP-403  Do not mix Joda-Time migration into the SQL-injection PR

Repo refs in every body: gitlab:coopai-group/training-java-monolith-refactor
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "gitlab:coopai-group/training-java-monolith-refactor"
REPO_URL = "https://gitlab.com/coopai-group/training-java-monolith-refactor"
CUSTOMERS_JSP = "src/main/webapp/customers.jsp"
CUSTOMER_DAO = "src/main/java/com/sourcegraph/demo/bigbadmonolith/dao/CustomerDAO.java"
CONNECTION_MANAGER = "src/main/java/com/sourcegraph/demo/bigbadmonolith/dao/ConnectionManager.java"
BILLING_SERVICE = "src/main/java/com/sourcegraph/demo/bigbadmonolith/service/BillingService.java"
DATE_UTILS = "src/main/java/com/sourcegraph/demo/bigbadmonolith/util/DateTimeUtils.java"
HOURS_JSP = "src/main/webapp/hours.jsp"

SLACK_THREADS: List[Tuple[str, List[str]]] = [
    (
        "COOP-401 SQL injection in customers.jsp",
        [
            (
                f"Kicking off COOP-401 on {REPO}. `{CUSTOMERS_JSP}` concatenates SQL in the JSP. "
                f"That's the SQL-injection training bug. Move writes into `{CUSTOMER_DAO}` first. "
                "Do not rewrite hours.jsp in the same change."
            ),
            (
                "Security wants this shipped this sprint. Don't also migrate Joda-Time "
                f"(`{DATE_UTILS}`) in the same PR — that's COOP-403 and it will bury the security review."
            ),
            (
                "Decision: extract customer SQL out of the JSP into CustomerDAO. Keep the JSP as a "
                f"thin form. Ticket COOP-401. Code: {REPO_URL}/-/blob/main/{CUSTOMERS_JSP}"
            ),
        ],
    ),
    (
        "COOP-402 JDBC connection leaks in JSPs",
        [
            (
                f"COOP-402 on {REPO}. JSPs open JDBC connections instead of using "
                f"`{CONNECTION_MANAGER}`. Resource leaks in hours.jsp and reports.jsp. "
                "If we only fix customers.jsp, on-call will still page on connection exhaustion."
            ),
            (
                "Safest first change after 401: route new code through ConnectionManager. "
                "Don't invent a second pool. Don't touch BillingService calculations in the same PR."
            ),
        ],
    ),
    (
        "COOP-403 pager: billing reports show the wrong day",
        [
            (
                f"Pager: reports.jsp totals look a day off. {REPO}. Likely Joda-Time in "
                f"`{DATE_UTILS}` vs the JSP doing its own date math. On-call runbook is in "
                "Google Docs / Confluence. COOP-403. Do not mix this into the SQL-injection PR."
            ),
            (
                f"Related: `{BILLING_SERVICE}` and `{HOURS_JSP}` both format dates. "
                "Decision from last week: java.time only on new code; leave Joda until 403 ships."
            ),
        ],
    ),
]


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


def env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


def http_json(
    method: str,
    url: str,
    headers: Dict[str, str],
    payload: Optional[Dict[str, Any]] = None,
) -> Any:
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=60) as response:
            body = response.read().decode()
            return json.loads(body) if body else {}
    except HTTPError as error:
        detail = error.read().decode() if error.fp else ""
        raise RuntimeError(f"{method} {url} failed ({error.code}): {detail}") from error


def adf_paragraph(text: str) -> Dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


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
            {"type": "listItem", "content": [adf_paragraph(item)]} for item in items
        ],
    }


def adf_doc(*blocks: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "doc", "version": 1, "content": list(blocks)}


@dataclass
class JiraTicket:
    number: int
    summary: str
    description: str
    criteria: List[str]
    comments: List[str]


JIRA_TICKETS = [
    JiraTicket(
        401,
        "Extract SQL from customers.jsp into CustomerDAO (SQL injection)",
        (
            "customers.jsp concatenates SQL in the JSP. Move customer writes into "
            "CustomerDAO.java. Do not rewrite hours.jsp or migrate Joda-Time in this ticket."
        ),
        [
            "SQL for customer create/update lives in CustomerDAO, not the JSP",
            "JSP stays a form / table only",
            f"Repos: {REPO}",
        ],
        [
            "Slack decision: security first. Joda-Time is COOP-403, not this PR.",
        ],
    ),
    JiraTicket(
        402,
        "Stop opening JDBC connections in JSPs — use ConnectionManager",
        (
            "hours.jsp and reports.jsp open JDBC connections in the presentation layer. "
            "Route new code through ConnectionManager.java. Do not invent a second pool. "
            "Do not change BillingService calculations in this ticket."
        ),
        [
            "New JDBC goes through ConnectionManager",
            "No second connection pool",
            f"Repos: {REPO}",
        ],
        [],
    ),
    JiraTicket(
        403,
        "Billing reports show the wrong day — Joda-Time vs JSP date math",
        (
            "reports.jsp totals look a day off. DateTimeUtils.java still uses Joda-Time. "
            "hours.jsp and BillingService also format dates. New code uses java.time only. "
            "Do not mix this into the SQL-injection PR (COOP-401)."
        ),
        [
            "Document the Joda vs java.time split in the on-call runbook",
            "Leave Joda in DateTimeUtils until this ticket ships",
            f"Repos: {REPO}",
        ],
        [],
    ),
]


def seed_slack(dry_run: bool, jira_keys: Dict[int, str]) -> None:
    token = env("SLACK_BOT_TOKEN")
    channel = env("SLACK_CHANNEL_ID")
    if not token or not channel:
        print("Slack: skip (need SLACK_BOT_TOKEN and SLACK_CHANNEL_ID)")
        return
    if dry_run:
        print(f"Slack: dry-run {len(SLACK_THREADS)} threads → {channel}")
        return
    from slack_sdk import WebClient
    from slack_sdk.errors import SlackApiError

    key_note = ""
    if jira_keys:
        mapped = ", ".join(f"COOP-{num}={jira_keys[num]}" for num in sorted(jira_keys))
        key_note = f" Jira keys this seed: {mapped}."

    client = WebClient(token=token)
    for title, messages in SLACK_THREADS:
        thread_ts = None
        for index, text in enumerate(messages):
            body = text + (key_note if index == 0 and key_note else "")
            kwargs: Dict[str, Any] = {"channel": channel, "text": f"[{title}]\n{body}" if index == 0 else body}
            if thread_ts:
                kwargs["thread_ts"] = thread_ts
            try:
                result = client.chat_postMessage(**kwargs)
            except SlackApiError as exc:
                print(f"Slack: fail {exc.response.get('error', exc)}")
                return
            if index == 0:
                thread_ts = result["ts"]
            time.sleep(0.4)
        print(f"Slack: posted {title}")


def seed_jira(dry_run: bool) -> Dict[int, str]:
    """Create (or reuse) glab dogfood tickets. Returns alias-number → real Jira key."""
    keys: Dict[int, str] = {}
    base = env("JIRA_BASE_URL").rstrip("/")
    email = env("JIRA_EMAIL")
    token = env("JIRA_API_TOKEN")
    project = env("JIRA_PROJECT_KEY", default="COOP").upper()
    if not base or not email or not token:
        print("Jira: skip (need JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)")
        return keys
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    api = f"{base}/rest/api/3"
    for ticket in JIRA_TICKETS:
        alias = f"COOP-{ticket.number}"
        if dry_run:
            print(f"Jira: dry-run {alias} {ticket.summary}")
            keys[ticket.number] = alias
            continue
        jql = quote(f'project = {project} AND labels = "java-dogfood" AND summary ~ "{ticket.summary[:40]}"')
        try:
            search = http_json("GET", f"{api}/search/jql?jql={jql}&maxResults=1", headers)
            existing = (search.get("issues") or [])
            if existing:
                real_key = existing[0]["key"]
                keys[ticket.number] = real_key
                print(f"Jira: reuse {real_key} (alias {alias})")
                continue
        except RuntimeError:
            pass
        description = adf_doc(
            adf_paragraph(f"Dogfood alias {alias}. Ask Coop for {alias} on {REPO}."),
            adf_paragraph(ticket.description),
            adf_heading("Repositories"),
            adf_bullet_list([REPO, REPO_URL]),
            adf_heading("Acceptance criteria"),
            adf_bullet_list(ticket.criteria),
        )
        try:
            created = http_json(
                "POST",
                f"{api}/issue",
                headers,
                {
                    "fields": {
                        "project": {"key": project},
                        "summary": f"{alias}: {ticket.summary}",
                        "description": description,
                        "issuetype": {"name": "Task"},
                        "labels": ["java-dogfood", "demo", alias.lower()],
                    }
                },
            )
        except RuntimeError as error:
            print(f"Jira: create {alias} failed: {error}")
            return keys
        real_key = created.get("key", alias)
        keys[ticket.number] = real_key
        print(f"Jira: created {real_key} (alias {alias})")
        for comment in ticket.comments:
            http_json(
                "POST",
                f"{api}/issue/{real_key}/comment",
                headers,
                {"body": adf_doc(adf_paragraph(comment))},
            )
        time.sleep(0.4)
    return keys


def seed_confluence(dry_run: bool) -> None:
    site = env("CONFLUENCE_BASE_URL", "JIRA_BASE_URL").rstrip("/")
    email = env("CONFLUENCE_EMAIL", "JIRA_EMAIL")
    token = env("CONFLUENCE_API_TOKEN", "JIRA_API_TOKEN")
    space = env("CONFLUENCE_SPACE_KEY", default="COOP").upper()
    if not site or not email or not token:
        print("Confluence: skip (need CONFLUENCE_* or JIRA_* )")
        return
    wiki = site if site.endswith("/wiki") else f"{site}/wiki"
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    title = "ADR: extract SQL from customers.jsp before any Joda-Time work (COOP-401)"
    html = (
        f"<p>Repo: {REPO}</p>"
        "<p>Decision: SQL injection in <code>src/main/webapp/customers.jsp</code> ships first. "
        "Move customer writes into <code>CustomerDAO.java</code>. Do not rewrite hours.jsp "
        "and do not migrate Joda-Time in the same change.</p>"
        "<p>Related: COOP-402 connection leaks via <code>ConnectionManager.java</code>. "
        "COOP-403 date bug in reports.jsp / DateTimeUtils.java — java.time on new code only.</p>"
        f"<p>Source: {REPO_URL}</p>"
    )
    if dry_run:
        print(f"Confluence: dry-run {title}")
        return
    found = http_json(
        "GET",
        f"{wiki}/rest/api/content?spaceKey={quote(space)}&title={quote(title)}&type=page&limit=1",
        headers,
    )
    if found.get("results"):
        print(f"Confluence: skip (exists) {title}")
        return
    created = http_json(
        "POST",
        f"{wiki}/rest/api/content",
        headers,
        {
            "type": "page",
            "title": title,
            "space": {"key": space},
            "body": {"storage": {"value": html, "representation": "storage"}},
        },
    )
    print(f"Confluence: created {created.get('id')} {title}")


def seed_google_docs(dry_run: bool) -> None:
    token = env("GOOGLE_DOCS_ACCESS_TOKEN", "GOOGLE_DOCS_SEED_ACCESS_TOKEN")
    if not token:
        print("Google Docs: skip (need GOOGLE_DOCS_ACCESS_TOKEN)")
        return
    title = "big-bad-monolith on-call: billing reports off by a day (COOP-403)"
    body = (
        f"Repo: {REPO}\n\n"
        "If billing reports show the wrong day:\n"
        "1. Check DateTimeUtils.java (Joda-Time) vs date math in reports.jsp and hours.jsp.\n"
        "2. BillingService.java also formats dates — don't change it in the SQL-injection PR.\n"
        "3. New code uses java.time only. Leave Joda until COOP-403 ships.\n"
        "4. Related tickets: COOP-401 SQL in customers.jsp, COOP-402 ConnectionManager leaks.\n"
        f"5. Source: {REPO_URL}\n"
    )
    if dry_run:
        print(f"Google Docs: dry-run {title}")
        return
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    created = http_json(
        "POST",
        "https://www.googleapis.com/drive/v3/files",
        headers,
        {"name": title, "mimeType": "application/vnd.google-apps.document"},
    )
    doc_id = created.get("id")
    if not doc_id:
        print(f"Google Docs: create failed {created}")
        return
    http_json(
        "POST",
        f"https://docs.googleapis.com/v1/documents/{doc_id}:batchUpdate",
        headers,
        {
            "requests": [
                {"insertText": {"location": {"index": 1}, "text": body}}
            ]
        },
    )
    print(f"Google Docs: created {doc_id} {title}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Java GitLab dogfood context.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_dotenv_file()
    print(f"Fixture {REPO}")
    jira_keys = seed_jira(args.dry_run)
    seed_slack(args.dry_run, jira_keys)
    seed_confluence(args.dry_run)
    seed_google_docs(args.dry_run)
    if jira_keys:
        print("Jira aliases → real keys:", jira_keys)
    print("Done. Teams skipped (Connect UI still coming soon).")


if __name__ == "__main__":
    main()
