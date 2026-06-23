#!/usr/bin/env python3
"""
Seed Google Docs with demo documents for Coop AI integration testing.

Document bodies include github:owner/repo references so Coop AI's Drive fullText
search (GoogleDocsClient.searchDocuments in src/api/googleDocs/googleDocsClient.ts)
finds them when you run /google-docs, ask about Google Docs, or test Knowledge Gaps.

Setup:
  1. Google Cloud project with Drive API + Google Docs API enabled.
  2. OAuth access token with write scopes (seeder only — Coop read uses drive.readonly):
     https://developers.google.com/oauthplayground
     Select: https://www.googleapis.com/auth/documents
             https://www.googleapis.com/auth/drive.file
     Authorize → Exchange authorization code → copy Access token.
  3. cp .env.example .env  # add GOOGLE_DOCS_ACCESS_TOKEN
  4. python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  5. .venv/bin/python populate_google_docs.py

Coop AI extension: paste a drive.readonly token in Settings → Tools → Google Docs,
or use Connect Google Docs in production.

Usage:
  .venv/bin/python populate_google_docs.py --dry-run
  .venv/bin/python populate_google_docs.py --pages architecture,onboarding
  .venv/bin/python populate_google_docs.py --update-existing
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
from urllib.parse import quote
from urllib.request import Request, urlopen

from demo_doc_pages import DemoPage, demo_pages

DOCS_API = "https://docs.googleapis.com/v1"
DRIVE_API = "https://www.googleapis.com/drive/v3"
FOLDER_MIME = "application/vnd.google-apps.folder"
DOCUMENT_MIME = "application/vnd.google-apps.document"


class GoogleDocsClient:
    def __init__(self, access_token: str) -> None:
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        url: str,
        payload: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, str]] = None,
    ) -> Any:
        full_url = url
        if query:
            params = "&".join(f"{quote(k)}={quote(v)}" for k, v in query.items())
            full_url = f"{url}?{params}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = Request(full_url, data=data, method=method, headers=self.headers)
        try:
            with urlopen(req, timeout=60) as response:
                body = response.read().decode()
                return json.loads(body) if body else {}
        except HTTPError as error:
            detail = error.read().decode() if error.fp else ""
            raise RuntimeError(f"Google API {method} {url} failed ({error.code}): {detail}") from error

    def current_user(self) -> Dict[str, Any]:
        return self._request("GET", f"{DRIVE_API}/about", query={"fields": "user"})

    def find_folder(self, name: str) -> Optional[str]:
        q = " and ".join(
            [
                f"name = '{escape_drive_query(name)}'",
                f"mimeType = '{FOLDER_MIME}'",
                "trashed = false",
            ]
        )
        result = self._request(
            "GET",
            f"{DRIVE_API}/files",
            query={"q": q, "pageSize": "1", "fields": "files(id,name)"},
        )
        files = result.get("files") or []
        return files[0]["id"] if files else None

    def create_folder(self, name: str) -> str:
        result = self._request(
            "POST",
            f"{DRIVE_API}/files",
            {"name": name, "mimeType": FOLDER_MIME},
        )
        return result["id"]

    def find_document(self, title: str, folder_id: Optional[str]) -> Optional[str]:
        clauses = [
            f"name = '{escape_drive_query(title)}'",
            f"mimeType = '{DOCUMENT_MIME}'",
            "trashed = false",
        ]
        if folder_id:
            clauses.append(f"'{folder_id}' in parents")
        result = self._request(
            "GET",
            f"{DRIVE_API}/files",
            query={
                "q": " and ".join(clauses),
                "pageSize": "1",
                "fields": "files(id,name)",
            },
        )
        files = result.get("files") or []
        return files[0]["id"] if files else None

    def create_document(self, title: str, folder_id: Optional[str]) -> str:
        result = self._request("POST", f"{DOCS_API}/documents", {"title": title})
        doc_id = result["documentId"]
        if folder_id:
            self._request(
                "PATCH",
                f"{DRIVE_API}/files/{doc_id}",
                query={"addParents": folder_id, "fields": "id"},
                payload={},
            )
        return doc_id

    def replace_document_body(self, doc_id: str, text: str) -> None:
        doc = self._request("GET", f"{DOCS_API}/documents/{doc_id}")
        end_index = doc["body"]["content"][-1]["endIndex"] - 1
        requests: List[Dict[str, Any]] = []
        if end_index > 1:
            requests.append(
                {
                    "deleteContentRange": {
                        "range": {"startIndex": 1, "endIndex": end_index},
                    }
                }
            )
        requests.append({"insertText": {"location": {"index": 1}, "text": text}})
        self._request(
            "POST",
            f"{DOCS_API}/documents/{doc_id}:batchUpdate",
            {"requests": requests},
        )


def escape_drive_query(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def repo_refs(repos: Sequence[str], github_owner: str) -> List[str]:
    refs: List[str] = []
    for suffix in repos:
        refs.append(f"github:{github_owner}/{suffix}")
        refs.append(f"{github_owner}/{suffix}")
        refs.append(suffix)
    return list(dict.fromkeys(refs))


def build_plain_text(page: DemoPage, github_owner: str, seeder_name: str) -> str:
    refs = repo_refs(page.repos, github_owner)
    lines: List[str] = ["Repositories covered:"]
    for ref in refs:
        lines.append(f"  • {ref}")
    lines.append("")

    for heading, body in page.sections:
        lines.append(heading)
        lines.append("")
        for paragraph in body.split("\n\n"):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            if "\n" in paragraph:
                for line in paragraph.split("\n"):
                    line = line.strip()
                    if line:
                        lines.append(f"  • {line}")
            else:
                lines.append(paragraph)
            lines.append("")

    if page.labels:
        lines.append(
            f"Labels: {', '.join(page.labels)}. "
            f"Seeded by scripts/{seeder_name} for Coop AI demo — not production docs."
        )

    return "\n".join(lines).strip() + "\n"


@dataclass
class Config:
    access_token: str
    github_owner: str
    folder_name: str
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

    access_token = resolve_config_value("GOOGLE_DOCS_ACCESS_TOKEN", "GOOGLE_DOCS_SEED_ACCESS_TOKEN")
    github_owner = resolve_config_value(
        "GOOGLE_DOCS_DEMO_GITHUB_OWNER",
        "CONFLUENCE_DEMO_GITHUB_OWNER",
        "JIRA_DEMO_GITHUB_OWNER",
        default="coop-ai",
    )
    folder_name = resolve_config_value("GOOGLE_DOCS_FOLDER_NAME", default="Coop AI Demo")

    if not access_token and not args.dry_run:
        print("Missing env: GOOGLE_DOCS_ACCESS_TOKEN", file=sys.stderr)
        print(
            "Get a write-scoped token from https://developers.google.com/oauthplayground "
            "(scopes: documents + drive.file). Edit scripts/.env (see .env.example).",
            file=sys.stderr,
        )
        sys.exit(1)

    page_filter = None
    if args.pages:
        page_filter = {x.strip().lower() for x in args.pages.split(",") if x.strip()}

    return Config(
        access_token=access_token,
        github_owner=github_owner,
        folder_name=folder_name,
        dry_run=args.dry_run,
        delay_sec=float(os.environ.get("GOOGLE_DOCS_DELAY_SEC", "0.5")),
        page_filter=page_filter,
        update_existing=args.update_existing,
    )


def ensure_folder(client: GoogleDocsClient, cfg: Config) -> Optional[str]:
    if cfg.dry_run:
        print(f"  [dry-run] ensure folder: {cfg.folder_name}")
        return None
    existing = client.find_folder(cfg.folder_name)
    if existing:
        print(f"  folder exists: {cfg.folder_name}")
        return existing
    folder_id = client.create_folder(cfg.folder_name)
    print(f"  created folder: {cfg.folder_name}")
    time.sleep(cfg.delay_sec)
    return folder_id


def seed_document(
    client: GoogleDocsClient,
    cfg: Config,
    page: DemoPage,
    folder_id: Optional[str],
) -> None:
    body = build_plain_text(page, cfg.github_owner, "populate_google_docs.py")
    existing_id = None if cfg.dry_run else client.find_document(page.title, folder_id)

    if existing_id and not cfg.update_existing:
        print(f"  skip {page.slug} (document exists: {page.title})")
        return

    if cfg.dry_run:
        refs = ", ".join(repo_refs(page.repos, cfg.github_owner))
        print(f"  [dry-run] {page.slug}: {page.title}")
        print(f"            refs: {refs}")
        return

    if existing_id and cfg.update_existing:
        client.replace_document_body(existing_id, body)
        print(f"  updated {page.slug}: {page.title}")
        time.sleep(cfg.delay_sec)
        return

    doc_id = client.create_document(page.title, folder_id)
    client.replace_document_body(doc_id, body)
    print(f"  created {page.slug}: {page.title}")
    time.sleep(cfg.delay_sec)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Google Docs demo documents for Coop AI")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without API writes")
    parser.add_argument(
        "--pages",
        metavar="SLUG,SLUG",
        help="Comma-separated page slugs only (architecture, onboarding, ...)",
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="Update documents that already exist (default: skip)",
    )
    args = parser.parse_args()
    cfg = load_config(args)

    pages = demo_pages()
    if cfg.page_filter:
        pages = [p for p in pages if p.slug in cfg.page_filter]

    print(f"Google Docs  folder={cfg.folder_name}  github_owner={cfg.github_owner}")
    print(f"Documents to seed: {len(pages)}  dry_run={cfg.dry_run}")

    client = GoogleDocsClient(cfg.access_token or "dry-run-token")

    if not cfg.dry_run:
        user = client.current_user().get("user", {})
        print(f"Authenticated as: {user.get('displayName', user.get('emailAddress', '?'))}")

    folder_id = ensure_folder(client, cfg)

    for page in pages:
        seed_document(client, cfg, page, folder_id)

    print("Done.")
    if cfg.dry_run:
        print("\nDry-run only. Run without --dry-run to create documents.")
    else:
        sample_repo = pages[0].repos[0] if pages else "coop-ai-core"
        print(
            f"\nVerify in Coop AI:\n"
            f"  1. Settings → Tools → Google Docs: drive.readonly token → Test Google Docs\n"
            f"  2. Set repo owner={cfg.github_owner}, repo={sample_repo} in Settings → Repository\n"
            f"  3. Chat: /google-docs what architecture docs exist?\n"
            f"     or: any google docs for this repo?"
        )


if __name__ == "__main__":
    main()
