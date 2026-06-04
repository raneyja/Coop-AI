#!/usr/bin/env python3
"""
Seed a demo Slack workspace with realistic engineering threads for Coop AI integration testing.

Setup (one time):
  1. Invite your bot (e.g. @Coupe AI Test Bot) to the target channel in Slack.
  2. Copy the channel ID from channel details (starts with C).
  3. export SLACK_BOT_TOKEN=xoxb-... SLACK_CHANNEL_ID=C...
  4. Optional: add user tokens in user_tokens.json to post as Jon / Coop Product / etc.
     (Bot tokens always post as the bot — user tokens are required for multi-author threads.)

Coop AI extension settings:
  Use a Slack *user* token (xoxp-...) with search:read, channels:history, groups:history.
  The bot token used here is for seeding only.

Usage:
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  cp .env.example .env   # fill in values
  source .env            # or export vars manually
  .venv/bin/python populate_slack.py
  .venv/bin/python populate_slack.py --dry-run
  .venv/bin/python populate_slack.py --threads 5   # post first N threads only
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

# ---------------------------------------------------------------------------
# Personas — display names must match Slack workspace members.
# IDs are resolved at runtime via users.list; defaults match CoopAI workspace.
# ---------------------------------------------------------------------------

PERSONAS = [
    "Jon",
    "Coop Product",
    "Coop Sales",
    "Coop Security",
    "Coop Hello",
    "Coop Support",
]

# ---------------------------------------------------------------------------
# Conversation definitions — edit freely to add/remove threads.
# Each message is (author_display_name, text).
# ---------------------------------------------------------------------------

CONVERSATIONS: List[Tuple[str, List[Tuple[str, str]]]] = [
    (
        "Monolith split: extracting coop-backend",
        [
            (
                "Jon",
                "Kicking off COOP-101 — we need to peel auth + repo indexing out of `coop-ai-core` "
                "into `coop-backend`. Right now every VS Code session hits the extension host for "
                "GitHub pagination and it's getting ugly.",
            ),
            (
                "Coop Product",
                "What's the user-visible impact if we slip a sprint? Sales is promising "
                "'works with 50k-commit monorepos' for the Acme pilot.",
            ),
            (
                "Jon",
                "If we slip, we keep the in-process path but cap history depth at 2k commits. "
                "Acme will hit that on `platform-api` in week one. I'd rather ship backend service "
                "with a degraded mode flag than pretend scale isn't a problem.",
            ),
            (
                "Coop Security",
                "Before anything leaves the extension host: where do repo tokens live in the new "
                "service? Same SecretStorage bridge or do we need a token broker?",
            ),
            (
                "Jon",
                "Token broker is COOP-108 scope. For 101 I'm proposing tokens never leave the "
                "extension — backend gets short-lived job tickets over localhost only. "
                "Happy to walk through threat model in `#security` tomorrow.",
            ),
            (
                "Coop Product",
                "OK — pilot stays on degraded cap if we miss date, but let's comms that early. "
                "I'll update the Acme mutual success plan.",
            ),
        ],
    ),
    (
        "WebSocket vs SSE for chat streaming",
        [
            (
                "Jon",
                "COOP-118: `coop-frontend` webview currently uses postMessage chunks from the "
                "extension. Product wants smoother token streaming. Options are SSE from a local "
                "helper vs. keeping everything in-process.",
            ),
            (
                "Coop Hello",
                "SSE feels simpler for the webview — we're already bundling React there. "
                "Do we have a local port story that won't freak out corporate IT?",
            ),
            (
                "Jon",
                "We can bind to 127.0.0.1:0 and pass the port via webview state. No inbound "
                "firewall rules. WebSocket buys us bi-directional but we don't need it until "
                "tool-call mid-stream cancel lands.",
            ),
            (
                "Coop Security",
                "+1 SSE on localhost. Require random path token in URL so other local processes "
                "can't snoop. Add that to COOP-118 acceptance criteria.",
            ),
            (
                "Coop Product",
                "Ship SSE behind a setting default-off for 0.3, then flip default once stable?",
            ),
            (
                "Jon",
                "Works. I'll split 118 into 118a (transport) and 118b (UX polish). PR will "
                "target `coop-web` first since ChatPanel lives there.",
            ),
        ],
    ),
    (
        "Redis cache invalidation bug in staging",
        [
            (
                "Coop Support",
                "Seeing stale ownership maps in staging — customer re-ran 'Who owns this?' and "
                "got last week's GitHub org chart. COOP-134 filed.",
            ),
            (
                "Jon",
                "Reproduced. `coop-backend` caches `ownershipGraph` for 24h but webhook from "
                "GitHub org changes doesn't bust the key. Classic.",
            ),
            (
                "Jon",
                "Hotfix: listen for `organization` webhook and delete `graph:{repoId}`. "
                "Longer term we should TTL to 15m max — the cache was over-tuned for demo latency.",
            ),
            (
                "Coop Support",
                "Customer is unblocked if we purge manually — what's the redis key pattern?",
            ),
            (
                "Jon",
                "`DEL graph:github:ORG/REPO` — I'll add an admin CLI command in `coop-cli` "
                "so support doesn't need redis-cli access.",
            ),
        ],
    ),
    (
        "On-prem ask from FinServ prospect",
        [
            (
                "Coop Sales",
                "Big prospect (Northwind) wants full on-prem including LLM routing. COOP-89. "
                "Is that even on the roadmap or do I push back?",
            ),
            (
                "Coop Product",
                "Push back on *our* LLM hosting. We can talk about VPC-deployed `coop-backend` "
                "with customer-managed model endpoints — that's COOP-90, not 89.",
            ),
            (
                "Coop Security",
                "On-prem without telemetry is fine if audit logs stay in their SIEM. "
                "We cannot support storing Slack/Jira creds in our cloud for that deal.",
            ),
            (
                "Coop Sales",
                "So pitch: extension + backend in their AWS, BYOK for Anthropic/OpenAI, "
                "we ship helm chart?",
            ),
            (
                "Jon",
                "Helm is wishful for Q2. Realistic is docker-compose + terraform module for "
                "`coop-backend` only; extension still from marketplace. I can scope eng effort.",
            ),
            (
                "Coop Product",
                "Give them 90 + private beta label. Don't promise helm dates in writing yet.",
            ),
        ],
    ),
    (
        "Security review: Slack token storage",
        [
            (
                "Coop Security",
                "Reviewing COOP-156 — users paste Slack user tokens into settings. "
                "Extension stores in VS Code SecretStorage. Any reason we don't use OAuth flow?",
            ),
            (
                "Jon",
                "OAuth for Slack user scopes needs a hosted redirect URI. We don't have "
                "coop-ai.dev/oauth/live yet — only marketing site. Manual token is MVP.",
            ),
            (
                "Coop Security",
                "MVP OK if we warn on paste, never log token, and clear clipboard suggestion. "
                "Also need scope list in UI so users don't over-provision admin scopes.",
            ),
            (
                "Jon",
                "Already strip on save and redact in logs. I'll add minimum scope copy: "
                "`search:read`, `channels:history`, `groups:history`, `users:read`.",
            ),
            (
                "Coop Security",
                "Approved with those UI changes. Re-review when OAuth ships.",
            ),
        ],
    ),
    (
        "Model routing: Claude vs GPT for decision archaeology",
        [
            (
                "Jon",
                "COOP-167 experiment results — Claude Sonnet nails narrative synthesis on "
                "decision threads; GPT-4o mini is 4x cheaper but hallucinates Jira keys 8% "
                "of the time in eval set.",
            ),
            (
                "Coop Product",
                "What's the cost delta at 1k MAU?",
            ),
            (
                "Jon",
                "~$420 vs ~$95/month at current prompt sizes. Archaeology runs are bursty — "
                "most users trigger 3-5 per week.",
            ),
            (
                "Coop Product",
                "Default Sonnet for archaeology, let power users pick mini in settings?",
            ),
            (
                "Jon",
                "Yes. `ModelRouter` already supports per-feature model map. I'll wire "
                "`decisionArchaeology` → configurable with Sonnet default.",
            ),
            (
                "Coop Hello",
                "Please add eval fixtures from real (sanitized) threads — I can help label.",
            ),
        ],
    ),
    (
        "Tech debt: duplicated types in coop-shared",
        [
            (
                "Jon",
                "Anyone else annoyed that `OwnershipSignal` exists in both `coop-shared` and "
                "`src/types/ownership.ts`? COOP-72 tracking the cleanup.",
            ),
            (
                "Coop Hello",
                "Yes — I added fields on the extension side last week and forgot to bump shared. "
                "My bad.",
            ),
            (
                "Jon",
                "Plan: extension imports from `@coop-ai/shared` only, delete duplicate, "
                "publish shared package 0.4.0. One PR in `coop-shared`, one consumer bump here.",
            ),
            (
                "Coop Product",
                "Does this block the ownership card UI work?",
            ),
            (
                "Jon",
                "Blocks merge to main, not local dev. Card can proceed on branch if types aligned "
                "by EOD Wednesday.",
            ),
        ],
    ),
    (
        "Ownership graph query timeout on large repos",
        [
            (
                "Coop Support",
                "Enterprise customer `legacy-payments` — ownership lookup spins forever then "
                "errors. COOP-201.",
            ),
            (
                "Jon",
                "12k contributors, 400k commits. Graph build is O(n) on blame sweep — we timeout "
                "at 30s in `ownershipGraph.ts`.",
            ),
            (
                "Jon",
                "Short term: incremental graph with `since` cursor stored in workspace state. "
                "Long term: move graph build to `coop-backend` worker queue.",
            ),
            (
                "Coop Product",
                "Can we show partial results while worker runs?",
            ),
            (
                "Jon",
                "Yes — stream top 10 by commit count immediately from cache, badge 'refining…' "
                "until worker finishes. UX spec in COOP-201 comments.",
            ),
            (
                "Coop Security",
                "Worker queue must respect repo scope — no cross-repo leakage when multiple "
                "folders open.",
            ),
        ],
    ),
    (
        "Thread switcher UI planning",
        [
            (
                "Coop Product",
                "COOP-178 designs are in Figma — thread dropdown in chat header. Eng estimate?",
            ),
            (
                "Coop Hello",
                "~3 days UI + 2 days persistence wiring. `chatThreadStore` already exists on "
                "extension side.",
            ),
            (
                "Jon",
                "Add 1 day for migration of in-memory threads to workspace storage. "
                "We can't ship without backwards compat for insiders.",
            ),
            (
                "Coop Product",
                "Cut rename-on-first-message for v1?",
            ),
            (
                "Coop Hello",
                "Keep auto-title — it's demo candy. Rename can be v1.1.",
            ),
        ],
    ),
    (
        "Bitbucket parity gap for code hosts",
        [
            (
                "Jon",
                "COOP-145 — Bitbucket Cloud lacks equivalent of GitHub's suggested reviewers API. "
                "Ownership analysis falls back to commit history only.",
            ),
            (
                "Coop Sales",
                "Atlassian shop in pipeline — is Bitbucket second-class forever?",
            ),
            (
                "Jon",
                "Not forever. We can ingest `CODEOWNERS` + PR participant API. Quality ~70% of "
                "GitHub until they ship reviewer suggestions.",
            ),
            (
                "Coop Product",
                "Document confidence score in UI so CS doesn't oversell.",
            ),
            (
                "Jon",
                "Added `sourceAuthority` weight adjustment for Bitbucket in last PR. "
                "Degradation notification already warns when signals are thin.",
            ),
        ],
    ),
    (
        "PR #342 — decision archaeology context link",
        [
            (
                "Jon",
                "PR #342 (`coop-ai-core`) adds Slack thread URL parsing in decision archaeology. "
                "Can someone sanity-check the regex against real permalinks?",
            ),
            (
                "Coop Hello",
                "Tested archives links — works for p1234567890 subdomain format. Fails on "
                "workspace redirect URLs without team ID.",
            ),
            (
                "Jon",
                "Good catch — normalizing via `slackClient.parseSlackThreadUrl` now follows "
                "redirect once. Updated COOP-192.",
            ),
            (
                "Coop Product",
                "Does this close the 'why was this built?' demo for board meeting?",
            ),
            (
                "Jon",
                "With seeded Slack threads + a linked Jira key in PR body, yes. Need demo "
                "workspace populated — running `populate_slack.py` this week.",
            ),
        ],
    ),
    (
        "Database migration rollback incident",
        [
            (
                "Jon",
                "Heads up — rolled back migration `2024_05_add_thread_title` in staging. "
                "COOP-129. Column existed from manual hotfix, flyway got confused.",
            ),
            (
                "Coop Support",
                "Any customer impact?",
            ),
            (
                "Jon",
                "Staging only. Prod migration unchanged. Added idempotent check before ALTER.",
            ),
            (
                "Coop Security",
                "Postmortem note: who had manual DDL access? Prefer only CI applies schema.",
            ),
            (
                "Jon",
                "Agreed — revoked direct psql for app team. CI-only from Monday.",
            ),
        ],
    ),
    (
        "CI flakiness on integration tests",
        [
            (
                "Jon",
                "COOP-164 — Slack integration tests fail ~15% on rate limit in CI. "
                "We're hitting real API with test token.",
            ),
            (
                "Coop Hello",
                "Can we record fixtures with nock/msw instead?",
            ),
            (
                "Jon",
                "Yes. Plan: check in sanitized JSON for `conversations.replies` and "
                "`search.messages`. Live test becomes weekly cron, not per-PR.",
            ),
            (
                "Coop Product",
                "Don't delete live test entirely — catches API drift.",
            ),
            (
                "Jon",
                "Weekly cron + manual `npm run test:integrations:live` before release.",
            ),
        ],
    ),
    (
        "Customer feedback: degradation notifications too noisy",
        [
            (
                "Coop Support",
                "COOP-188 — three tickets this week saying amber degradation banner stays up "
                "after Slack reconnects.",
            ),
            (
                "Jon",
                "Bug in `DegradationNotification` — we clear `slack` from unavailable list "
                "but not the sticky banner state. Fixing today.",
            ),
            (
                "Coop Product",
                "Also shorten copy — 'Slack offline' → 'Slack context temporarily limited'.",
            ),
            (
                "Coop Support",
                "Customers like knowing *what* still works. Bullets help.",
            ),
            (
                "Jon",
                "PR will list active vs degraded features inline. Matches settings health check.",
            ),
        ],
    ),
    (
        "Slack search API rate limits at scale",
        [
            (
                "Jon",
                "COOP-210 — `search.messages` user token limit is ~20/min. Decision archaeology "
                "can burst 5 queries per trace. Large org will hit this.",
            ),
            (
                "Coop Product",
                "What's the fallback?",
            ),
            (
                "Jon",
                "Cache recent searches in extension globalState + backoff with user-visible "
                "'try again in 30s'. Longer term: index Slack exports in backend.",
            ),
            (
                "Coop Security",
                "Backend indexing needs customer consent — lots of DMs in search scope.",
            ),
            (
                "Jon",
                "Default archaeology queries public channels + threads linked from PRs only. "
                "DM search opt-in stays off.",
            ),
        ],
    ),
    (
        "Architecture: webview vs native sidebar",
        [
            (
                "Coop Product",
                "Revisiting COOP-55 — any regret picking webview for entire chat UI?",
            ),
            (
                "Jon",
                "Performance is fine. Pain is min-width enforcement and keyboard focus — "
                "we're fighting VS Code webview sandbox.",
            ),
            (
                "Coop Hello",
                "Native React tree would lose rapid iteration. I'd keep webview until we hit "
                "a hard platform limit.",
            ),
            (
                "Jon",
                "`PanelWidthEnforcer` hack works. Monitor crash rates — if webview OOM spikes, "
                "revisit.",
            ),
            (
                "Coop Product",
                "OK — webview stays. Invest in design system tokens instead.",
            ),
        ],
    ),
    (
        "Debugging null thread_ts in Slack replies",
        [
            (
                "Jon",
                "Weird one — COOP-219. `conversations.replies` returned parent without "
                "`thread_ts` on single-message threads in demo workspace.",
            ),
            (
                "Coop Hello",
                "Is that the seeded bot threads case?",
            ),
            (
                "Jon",
                "Yeah — when bot posts without replies yet, parent ts === thread ts. "
                "Fixed client to treat first message ts as thread anchor.",
            ),
            (
                "Jon",
                "Added unit test with fixture from populate script output.",
            ),
        ],
    ),
    (
        "Jira webhook lag breaking trace-decision",
        [
            (
                "Coop Support",
                "User says Jira ticket status wrong in trace — shows 'In Progress' but "
                "ticket closed yesterday. COOP-175.",
            ),
            (
                "Jon",
                "Webhook delay from their Jira Cloud — up to 10 min. We poll on manual "
                "refresh but not on auto trace.",
            ),
            (
                "Jon",
                "Adding `jira.getIssue` fresh fetch when user runs trace-decision quick action. "
                "Webhook still updates cache for background.",
            ),
            (
                "Coop Product",
                "Show 'last synced' timestamp in Jira card?",
            ),
            (
                "Jon",
                "Yes — small text under ticket key. COOP-175 updated.",
            ),
        ],
    ),
    (
        "Prompt library versioning",
        [
            (
                "Coop Product",
                "COOP-198 — customers want shared prompt library across team. "
                "Git repo? Gist? S3?",
            ),
            (
                "Jon",
                "Start with `.coop/prompts.json` in repo — zero infra, fits dev workflow. "
                "Later: optional sync from `coop-backend` for non-git teams.",
            ),
            (
                "Coop Security",
                "Prompts may contain internal codenames — respect `.coopignore` for paths "
                "that shouldn't upload.",
            ),
            (
                "Coop Hello",
                "I'll add import/export in Prompt Library modal — matches Figma v2.",
            ),
            (
                "Coop Product",
                "Ship repo-file first; backend sync is 199, not 198.",
            ),
        ],
    ),
    (
        "Release blocker: marketplace review timeline",
        [
            (
                "Coop Product",
                "COOP-225 — VS Code marketplace review queue is 5-7 days. We miss May window "
                "if we don't submit Thursday.",
            ),
            (
                "Jon",
                "Blocking items: Slack token help text, ownership card polish, one open P0 on "
                "thread persistence.",
            ),
            (
                "Coop Hello",
                "P0 fixed in branch `fix/thread-persist`. Card polish is cosmetic — can ship "
                "in 0.3.1?",
            ),
            (
                "Coop Product",
                "Card can wait. Thread persist cannot. Submit Thursday with changelog draft.",
            ),
            (
                "Jon",
                "I'll cut `0.3.0` RC after demo Slack seed validates archaeology end-to-end.",
            ),
            (
                "Coop Sales",
                "Ping me when RC is up — I have three design partners ready to install.",
            ),
        ],
    ),
]


@dataclass
class Config:
    bot_token: str
    channel_id: str
    delay_min: float
    delay_max: float
    user_tokens: Dict[str, str]
    dry_run: bool
    thread_limit: Optional[int]


def load_config(args: argparse.Namespace) -> Config:
    bot_token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    channel_id = os.environ.get("SLACK_CHANNEL_ID", "").strip()
    if not bot_token:
        sys.exit("Missing SLACK_BOT_TOKEN (export or add to scripts/.env).")
    if not channel_id and not args.dry_run:
        sys.exit("Missing SLACK_CHANNEL_ID — copy from Slack channel details.")

    delay_min = float(os.environ.get("SLACK_DELAY_MIN", "1.5"))
    delay_max = float(os.environ.get("SLACK_DELAY_MAX", "4.0"))
    if delay_min > delay_max:
        delay_min, delay_max = delay_max, delay_min

    user_tokens: Dict[str, str] = {}
    tokens_file = os.environ.get("SLACK_USER_TOKENS_FILE", "").strip()
    if tokens_file:
        path = Path(tokens_file)
        if not path.exists():
            sys.exit(f"SLACK_USER_TOKENS_FILE not found: {path}")
        with path.open(encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict):
            sys.exit("User tokens file must be a JSON object {displayName: token}.")
        user_tokens = {str(k): str(v).strip() for k, v in raw.items() if v}

    return Config(
        bot_token=bot_token,
        channel_id=channel_id,
        delay_min=delay_min,
        delay_max=delay_max,
        user_tokens=user_tokens,
        dry_run=args.dry_run,
        thread_limit=args.threads,
    )


def resolve_persona_ids(client: WebClient) -> Dict[str, str]:
    """Map display name → user ID using users.list."""
    mapping: Dict[str, str] = {}
    cursor: Optional[str] = None
    while True:
        response = client.users_list(limit=200, cursor=cursor)
        for member in response.get("members", []):
            if member.get("deleted") or member.get("id") == "USLACKBOT":
                continue
            profile = member.get("profile", {})
            names = {
                profile.get("display_name", "").strip(),
                profile.get("real_name", "").strip(),
                member.get("name", "").strip(),
            }
            for name in names:
                if name:
                    mapping[name] = member["id"]
                    mapping[name.lower()] = member["id"]
        cursor = response.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
    return mapping


def client_for_author(config: Config, author: str) -> WebClient:
    token = config.user_tokens.get(author)
    if token:
        return WebClient(token=token)
    return WebClient(token=config.bot_token)


def verify_setup(config: Config) -> Tuple[WebClient, Dict[str, str]]:
    bot_client = WebClient(token=config.bot_token)
    try:
        auth = bot_client.auth_test()
    except SlackApiError as exc:
        sys.exit(f"auth.test failed: {exc.response.get('error', exc)}")

    if not auth.get("ok"):
        sys.exit(f"auth.test failed: {auth.get('error', 'unknown')}")

    team = auth.get("team", "workspace")
    bot_user = auth.get("user", "bot")
    print(f"Connected to Slack workspace “{team}” as bot user {bot_user}.")

    persona_ids = resolve_persona_ids(bot_client)
    missing = [p for p in PERSONAS if p not in persona_ids and p.lower() not in persona_ids]
    if missing:
        print(f"Warning: personas not found in workspace: {', '.join(missing)}")

    if config.user_tokens:
        print(f"User tokens loaded for: {', '.join(sorted(config.user_tokens))}")
    else:
        print(
            "No user tokens — all messages will post as the bot app.\n"
            "  For multi-author threads, copy user_tokens.json.example → user_tokens.json"
        )

    if not config.dry_run:
        try:
            probe = bot_client.chat_postMessage(
                channel=config.channel_id,
                text="Coop AI demo seed: connectivity check (safe to delete)",
            )
            bot_client.chat_delete(channel=config.channel_id, ts=probe["ts"])
        except SlackApiError as exc:
            err = exc.response.get("error", str(exc))
            if err == "channel_not_found":
                sys.exit(
                    "Channel not found or bot not invited.\n"
                    "  1. In Slack, /invite @Coupe AI Test Bot to your channel\n"
                    "  2. Set SLACK_CHANNEL_ID to the channel ID (not name)"
                )
            if err == "not_in_channel":
                sys.exit("Bot is not in the channel — invite it with /invite @YourBot")
            sys.exit(f"Cannot post to channel: {err}")

        print(f"Channel {config.channel_id} verified.")

    return bot_client, persona_ids


def human_delay(config: Config) -> None:
    if config.dry_run:
        return
    time.sleep(random.uniform(config.delay_min, config.delay_max))


def post_thread(
    config: Config,
    persona_ids: Dict[str, str],
    title: str,
    messages: List[Tuple[str, str]],
    index: int,
    total: int,
) -> None:
    print(f"\n[{index}/{total}] {title} ({len(messages)} messages)")

    thread_ts: Optional[str] = None
    for msg_index, (author, text) in enumerate(messages):
        prefix = f"  {'└─' if msg_index else '├─'} {author}: "
        if config.dry_run:
            preview = text.replace("\n", " ")[:90]
            print(f"{prefix}{preview}{'…' if len(text) > 90 else ''}")
            continue

        client = client_for_author(config, author)
        kwargs = {"channel": config.channel_id, "text": text}
        if thread_ts:
            kwargs["thread_ts"] = thread_ts

        try:
            result = client.chat_postMessage(**kwargs)
        except SlackApiError as exc:
            err = exc.response.get("error", str(exc))
            print(f"  ERROR posting as {author}: {err}")
            raise

        if msg_index == 0:
            thread_ts = result["ts"]
        print(f"{prefix}posted (ts={result['ts']})")
        human_delay(config)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo Slack threads for Coop AI.")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without posting")
    parser.add_argument(
        "--threads",
        type=int,
        default=None,
        metavar="N",
        help="Post only the first N conversation threads",
    )
    args = parser.parse_args()
    config = load_config(args)

    conversations = CONVERSATIONS
    if config.thread_limit is not None:
        conversations = conversations[: config.thread_limit]

    _, persona_ids = verify_setup(config)

    print(f"\nPosting {len(conversations)} threads to channel {config.channel_id or '(dry-run)'}…")
    for idx, (title, messages) in enumerate(conversations, start=1):
        post_thread(config, persona_ids, title, messages, idx, len(conversations))

    print("\nDone." if not config.dry_run else "\nDry run complete — no messages posted.")


if __name__ == "__main__":
    main()
