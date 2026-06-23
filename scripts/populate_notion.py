#!/usr/bin/env python3
"""
Seed Notion with demo pages for Coop AI integration testing.

Page bodies include github:owner/repo references so Coop AI's Notion search
(NotionClient.searchPages in src/api/notion/notionClient.ts) finds them when you
run /notion, ask about Notion pages, or test Knowledge Gaps.

Setup:
  1. Create an internal integration: https://www.notion.so/my-integrations
     Capabilities: Read content, Update content, Insert content.
  2. Share a top-level page (or the workspace) with the integration.
  3. cp .env.example .env  # add NOTION_INTEGRATION_TOKEN
  4. python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  5. .venv/bin/python populate_notion.py

Optional: NOTION_PARENT_PAGE_ID — required for internal connections. Create a page
in Notion, share it with the integration (Content access), copy the 32-char ID from
the page URL into scripts/.env. Demo pages are created under a "Coop AI Demo" child.

Coop AI extension: Connect Notion in Settings (OAuth), or paste a token in dev mode.

Usage:
  .venv/bin/python populate_notion.py --dry-run
  .venv/bin/python populate_notion.py --pages architecture,onboarding
  .venv/bin/python populate_notion.py --update-existing
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from demo_doc_pages import DemoPage, demo_pages

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
MAX_RICH_TEXT = 2000


class NotionClient:
    def __init__(self, token: str) -> None:
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Any:
        data = json.dumps(payload).encode() if payload is not None else None
        req = Request(f"{NOTION_API}{path}", data=data, method=method, headers=self.headers)
        try:
            with urlopen(req, timeout=60) as response:
                body = response.read().decode()
                return json.loads(body) if body else {}
        except HTTPError as error:
            detail = error.read().decode() if error.fp else ""
            raise RuntimeError(f"Notion {method} {path} failed ({error.code}): {detail}") from error

    def current_user(self) -> Dict[str, Any]:
        return self._request("GET", "/users/me")

    def search_pages(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        result = self._request(
            "POST",
            "/search",
            {
                "query": query,
                "page_size": limit,
                "filter": {"property": "object", "value": "page"},
                "sort": {"direction": "descending", "timestamp": "last_edited_time"},
            },
        )
        return result.get("results") or []

    def find_page_by_title(self, title: str, parent_id: Optional[str] = None) -> Optional[str]:
        for page in self.search_pages(title, limit=50):
            if extract_title(page) != title:
                continue
            if parent_id:
                parent = page.get("parent") or {}
                if parent.get("page_id") != parent_id:
                    continue
            page_id = page.get("id")
            if page_id:
                return page_id
        return None

    def create_page(
        self,
        title: str,
        parent: Dict[str, Any],
        children: List[Dict[str, Any]],
    ) -> str:
        payload: Dict[str, Any] = {
            "parent": parent,
            "properties": {
                "title": {
                    "title": [{"type": "text", "text": {"content": title[:MAX_RICH_TEXT]}}],
                }
            },
        }
        if children:
            payload["children"] = children
        result = self._request("POST", "/pages", payload)
        return result["id"]

    def list_child_blocks(self, page_id: str) -> List[str]:
        block_ids: List[str] = []
        cursor: Optional[str] = None
        while True:
            path = f"/blocks/{page_id}/children?page_size=100"
            if cursor:
                path += f"&start_cursor={cursor}"
            result = self._request("GET", path)
            for block in result.get("results") or []:
                block_id = block.get("id")
                if block_id:
                    block_ids.append(block_id)
            if not result.get("has_more"):
                break
            cursor = result.get("next_cursor")
        return block_ids

    def archive_block(self, block_id: str) -> None:
        self._request("PATCH", f"/blocks/{block_id}", {"archived": True})

    def append_blocks(self, page_id: str, children: List[Dict[str, Any]]) -> None:
        self._request(
            "PATCH",
            f"/blocks/{page_id}/children",
            {"children": children},
        )

    def replace_page_body(self, page_id: str, children: List[Dict[str, Any]]) -> None:
        for block_id in self.list_child_blocks(page_id):
            self.archive_block(block_id)
        if children:
            self.append_blocks(page_id, children)


def extract_title(page: Dict[str, Any]) -> Optional[str]:
    properties = page.get("properties") or {}
    for value in properties.values():
        title_parts = value.get("title") or []
        text = "".join(part.get("plain_text", "") for part in title_parts).strip()
        if text:
            return text
    return None


def rich_text(content: str) -> List[Dict[str, Any]]:
    parts: List[Dict[str, Any]] = []
    remaining = content
    while remaining:
        chunk = remaining[:MAX_RICH_TEXT]
        remaining = remaining[MAX_RICH_TEXT:]
        parts.append({"type": "text", "text": {"content": chunk}})
    return parts


def paragraph(text: str) -> Dict[str, Any]:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {"rich_text": rich_text(text)},
    }


def heading_2(text: str) -> Dict[str, Any]:
    return {
        "object": "block",
        "type": "heading_2",
        "heading_2": {"rich_text": rich_text(text)},
    }


def bullet(text: str) -> Dict[str, Any]:
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {"rich_text": rich_text(text)},
    }


def repo_refs(repos: Sequence[str], github_owner: str) -> List[str]:
    refs: List[str] = []
    for suffix in repos:
        refs.append(f"github:{github_owner}/{suffix}")
        refs.append(f"{github_owner}/{suffix}")
        refs.append(suffix)
    return list(dict.fromkeys(refs))


def build_blocks(page: DemoPage, github_owner: str) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = [paragraph("Repositories covered:")]
    for ref in repo_refs(page.repos, github_owner):
        blocks.append(bullet(ref))
    blocks.append(paragraph(""))

    for heading, body in page.sections:
        blocks.append(heading_2(heading))
        for paragraph_text in body.split("\n\n"):
            paragraph_text = paragraph_text.strip()
            if not paragraph_text:
                continue
            if "\n" in paragraph_text:
                for line in paragraph_text.split("\n"):
                    line = line.strip()
                    if line:
                        blocks.append(bullet(line))
            else:
                blocks.append(paragraph(paragraph_text))

    if page.labels:
        blocks.append(
            paragraph(
                f"Labels: {', '.join(page.labels)}. "
                "Seeded by scripts/populate_notion.py for Coop AI demo — not production docs."
            )
        )

    return blocks


@dataclass
class Config:
    token: str
    github_owner: str
    parent_page_id: Optional[str]
    demo_root_name: str
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

    token = resolve_config_value("NOTION_INTEGRATION_TOKEN", "NOTION_TOKEN")
    github_owner = resolve_config_value(
        "NOTION_DEMO_GITHUB_OWNER",
        "CONFLUENCE_DEMO_GITHUB_OWNER",
        "JIRA_DEMO_GITHUB_OWNER",
        default="coop-ai",
    )
    parent_page_id = resolve_config_value("NOTION_PARENT_PAGE_ID") or None
    demo_root_name = resolve_config_value("NOTION_DEMO_ROOT_NAME", default="Coop AI Demo")

    if not token and not args.dry_run:
        print("Missing env: NOTION_INTEGRATION_TOKEN", file=sys.stderr)
        print(
            "Create an internal integration at https://www.notion.so/my-integrations "
            "(Read + Insert + Update content), share a page with it, and add the secret to scripts/.env.",
            file=sys.stderr,
        )
        sys.exit(1)

    page_filter = None
    if args.pages:
        page_filter = {x.strip().lower() for x in args.pages.split(",") if x.strip()}

    return Config(
        token=token,
        github_owner=github_owner,
        parent_page_id=parent_page_id,
        demo_root_name=demo_root_name,
        dry_run=args.dry_run,
        delay_sec=float(os.environ.get("NOTION_DELAY_SEC", "0.4")),
        page_filter=page_filter,
        update_existing=args.update_existing,
    )


def ensure_demo_root(client: NotionClient, cfg: Config) -> Optional[str]:
    if not cfg.parent_page_id:
        if cfg.dry_run:
            print(f"  [dry-run] would create root under NOTION_PARENT_PAGE_ID: {cfg.demo_root_name}")
            return None
        print("Missing env: NOTION_PARENT_PAGE_ID", file=sys.stderr)
        print(
            "Internal Notion connections cannot create workspace-level pages.\n"
            "1. Browser — Notion: create or open a page, share it with your integration\n"
            "2. Copy the page ID from the URL (32 chars after the workspace name)\n"
            "3. File — scripts/.env → NOTION_PARENT_PAGE_ID=<that-id>",
            file=sys.stderr,
        )
        sys.exit(1)

    if cfg.dry_run:
        print(f"  [dry-run] ensure root page under parent: {cfg.demo_root_name}")
        return None

    existing = client.find_page_by_title(cfg.demo_root_name, cfg.parent_page_id)
    if existing:
        print(f"  root page exists: {cfg.demo_root_name}")
        return existing

    page_id = client.create_page(
        cfg.demo_root_name,
        {"type": "page_id", "page_id": cfg.parent_page_id},
        [paragraph("Demo documentation for Coop AI Notion integration testing.")],
    )
    print(f"  created root page: {cfg.demo_root_name}")
    time.sleep(cfg.delay_sec)
    return page_id


def seed_page(
    client: NotionClient,
    cfg: Config,
    page: DemoPage,
    parent_id: Optional[str],
) -> None:
    blocks = build_blocks(page, cfg.github_owner)
    parent_ref = (
        {"type": "page_id", "page_id": parent_id}
        if parent_id
        else {"type": "workspace", "workspace": True}
    )
    existing_id = None if cfg.dry_run or not parent_id else client.find_page_by_title(page.title, parent_id)

    if existing_id and not cfg.update_existing:
        print(f"  skip {page.slug} (page exists: {page.title})")
        return

    if cfg.dry_run:
        refs = ", ".join(repo_refs(page.repos, cfg.github_owner))
        print(f"  [dry-run] {page.slug}: {page.title}")
        print(f"            refs: {refs}")
        return

    if existing_id and cfg.update_existing:
        client.replace_page_body(existing_id, blocks)
        print(f"  updated {page.slug}: {page.title}")
        time.sleep(cfg.delay_sec)
        return

    client.create_page(page.title, parent_ref, blocks)
    print(f"  created {page.slug}: {page.title}")
    time.sleep(cfg.delay_sec)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Notion demo pages for Coop AI")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without API writes")
    parser.add_argument(
        "--pages",
        metavar="SLUG,SLUG",
        help="Comma-separated page slugs only (architecture, onboarding, ...)",
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

    print(f"Notion  root={cfg.demo_root_name}  github_owner={cfg.github_owner}")
    print(f"Pages to seed: {len(pages)}  dry_run={cfg.dry_run}")

    client = NotionClient(cfg.token or "dry-run-token")

    if not cfg.dry_run:
        user = client.current_user()
        bot = user.get("bot") or {}
        owner = bot.get("owner") or {}
        name = (owner.get("user") or {}).get("name") or user.get("name") or "?"
        print(f"Authenticated as: {name}")

    parent_id = ensure_demo_root(client, cfg)

    for page in pages:
        seed_page(client, cfg, page, parent_id)

    print("Done.")
    if cfg.dry_run:
        print("\nDry-run only. Run without --dry-run to create pages.")
    else:
        sample_repo = pages[0].repos[0] if pages else "coop-ai-core"
        print(
            f"\nVerify in Coop AI:\n"
            f"  1. Settings → Tools → Notion: Connect or paste token → Test Notion\n"
            f"  2. Set repo owner={cfg.github_owner}, repo={sample_repo} in Settings → Repository\n"
            f"  3. Chat: /notion what architecture pages exist?\n"
            f"     or: any notion pages for this repo?"
        )


if __name__ == "__main__":
    main()
