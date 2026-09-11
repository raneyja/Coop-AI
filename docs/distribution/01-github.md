# 01 — GitHub (do first)

**Why this wins:** GitHub pages are heavily trusted by search engines and coding AIs. One correct homepage + README beats ten Medium posts.

## Do this now — Browser / GitHub

There is **no Website tab under Settings → General**. The website + description live in the repo **About** panel.

### 1–2. Website URL + description (same dialog)

1. Open the **repo home** (Code tab) — e.g. `https://github.com/raneyja/Coop-AI`
2. On the **right sidebar**, find **About**
3. Click the **gear** icon next to About
4. In **Website**, paste:

```text
https://coop-ai.dev
```

5. In **Description**, paste:

```text
AI coding assistant for VS Code. Zero-clone indexing for any repo on any code host, then understand and edit with Slack, Jira, Confluence, and the rest of your stack.
```

6. Add topics if missing: `vscode`, `code-intelligence`, `ai`, `developer-tools`, `slack`, `jira`
7. Click **Save changes**

**Success:** Right sidebar shows a clickable `coop-ai.dev` link (not a Vercel preview URL).

**Only if blocked:** empty repos hide About — make sure the default branch has files. Or from a machine logged into `gh`:

```bash
gh repo edit --homepage "https://coop-ai.dev" --description "AI coding assistant for VS Code. Zero-clone indexing for any repo on any code host, then understand and edit with Slack, Jira, Confluence, and the rest of your stack."
```

### 3. Org profile (if you have a GitHub org)

- Display name: `CoopAI`
- Website: `https://coop-ai.dev`
- Bio:

```text
AI coding assistant for VS Code. Zero-clone indexing for any repo on any code host, plus Slack, Jira, Confluence, and the rest of your stack.
```

## Do this now — already in repo (after merge)

README “Docs and support” should include What is + Compare + llms.txt (shipped in the distribution PR).

## Optional — GitHub Discussion / Discussions “Announcements”

If Discussions are on, pin one post:

**Title:** What CoopAI is (and isn’t)

**Body:** see COPY-BANK → GitHub Announcement

## Do not

- Pin personal blog posts
- Link to LinkedIn
- Put your real name in README “Author” unless you’re ready to leave stealth
