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
VS Code extension that understands and edits production code with your full stack as context — repo graph plus company Slack/Jira. Find owners, check blast radius, write changes you review, without cloning the monorepo.
```

6. Add topics if missing: `vscode`, `code-intelligence`, `ai`, `developer-tools`, `slack`, `jira`
7. Click **Save changes**

**Success:** Right sidebar shows a clickable `coop-ai.dev` link (not a Vercel preview URL).

**Only if blocked:** empty repos hide About — make sure the default branch has files. Or from a machine logged into `gh`:

```bash
gh repo edit --homepage "https://coop-ai.dev" --description "VS Code extension that understands and edits production code with your full stack as context — repo graph plus company Slack/Jira. Find owners, check blast radius, write changes you review, without cloning the monorepo."
```

### 3. Org profile (if you have a GitHub org)

- Display name: `CoopAI`
- Website: `https://coop-ai.dev`
- Bio:

```text
Code intelligence for VS Code. Understand and edit production code with your full stack as context — repo graph + company Slack/Jira — without cloning the monorepo.
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
