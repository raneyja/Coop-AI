---
title: Create pull request
description: Open a GitHub pull request (PR) from an applied /edit patch — confirm branch, title, and notes in VS Code.
section: extension
order: 5
lastUpdated: "2026-08-21"
---

<!-- figures lg -->
![Create pull request — confirm branch, title, and AI-generated notes after applying an /edit patch](/screenshots/docs/extension-create-pull-request.png)
<!-- /figures -->

After you **Apply** an `/edit` patch, Coop can open a pull request on your code host without leaving VS Code. You confirm the branch, title, and notes first — nothing is created on GitHub (or GitLab / Bitbucket) until you click **Create pull request**.

This is the last step of the edit loop: describe a change → review the diff → apply → open a PR for your team.

**Notes model:** Coop assigns **OpenAI GPT-4o mini** for the optional **Notes (AI Generated)** summary. You can edit or clear the notes before submit. See [Model assignments](/docs/model-assignments).

## When to use it

| Open a PR from Coop | Keep the change local |
| --- | --- |
| The patch is applied and you want a reviewable PR on the host | You are still iterating — **Undo** and run `/edit` again |
| The repo is selected with **Use repo** and your org’s GitHub (or GitLab / Bitbucket) is **Connected** | You only needed the edit in the editor |
| You want Coop to draft a title and notes from the diff | You will open the PR yourself outside Coop |

There is no `/pr` slash command. **Create pull request** appears on the **Patch applied** card after Apply.

## What you need first

1. **Extension UI** — Sign in under **Settings → Account**.
2. **Extension UI** — Click **Use repo** on the repository in the Remote workspace picker (same as [Understand Repo](/manual#understand-repo)). Settings → Workspace owner/repo alone is not enough.
3. **Admin portal** — GitHub (or GitLab / Bitbucket) already **Connected** for your org — the same connection used for indexing. You do not create a token or change App permissions. If it is not connected, ask your admin. See [GitHub](/docs/github).
4. **Extension UI** — Run `/edit`, then **Apply** the patch. The Create pull request button only appears after Apply.

**Success:** The patch card says **Patch applied** and **Create pull request** is visible on that card.

## How to open a pull request

1. **Generate** — **Extension UI** — chat composer: `/edit <instruction>` (or `/patch`, `/fix`).
2. **Apply** — **Extension UI** — click **Apply** on the patch card (or **CoopAI: Apply Patch**). Success: **Patch applied** and the file list.
3. **Create** — **Extension UI** — click **Create pull request** on that same card. Coop opens the confirm modal and starts generating notes.
4. **Confirm** — Check **Branch**, **Title**, and **Notes**. Edit any field. The **Files** list is the paths Coop will commit.
5. **Submit** — Click **Create pull request**. Success: the modal title becomes **Pull request created** with a host URL. Click **Open on GitHub** (or GitLab / Bitbucket) to review it in the browser.

**Cancel, Escape, or clicking the backdrop creates nothing on the host.** Closing the modal is safe.

| Step | Surface | Action |
| --- | --- | --- |
| Generate | **Extension UI** — chat composer | `/edit <instruction>` with a selection or open file |
| Apply | **Extension UI** — patch card | **Apply** |
| Open modal | **Extension UI** — patch card | **Create pull request** (after Apply only) |
| Submit | **Extension UI** — modal | Confirm fields → **Create pull request** |
| Cancel | **Extension UI** — modal | **Cancel**, Escape, or backdrop — no branch, commit, or PR |
| Open | **Browser** | **Open on GitHub** (or the host link in the success modal) |

## What you confirm

The modal pre-fills defaults from the applied patch. Every field is editable.

| Field | Default | What it becomes on the host |
| --- | --- | --- |
| **Branch** | `coop/patch` | New branch created from the repo’s primary branch, then files committed onto it. If `coop/patch` already exists, Coop commits onto that branch. |
| **Title** | `Update path/to/file` (one file) or `Update N files` | Pull request title |
| **Notes (AI Generated)** | Short summary of the applied diff | Pull request body. Optional — you can edit, replace, or clear it. Labeled **(AI Generated)** so reviewers know Coop drafted it. |
| **Files** | Paths from the applied patch | Files committed on the branch. Empty files are skipped. |

Notes are drafted from the diff only. Coop does not invent tickets, reviewers, or test results. If the summary fails or times out, the notes field stays empty — you can still create the PR.

Branch names may use letters, numbers, `.`, `_`, `-`, and `/`. No spaces. Max 200 characters.

## What happens on the host

Coop writes through the code host your org admin already connected — not a local `git push`, and not a personal token in VS Code.

1. Create (or reuse) the **Branch** from the branch Coop is using for this repo (**Use repo** / Workspace). That branch is also the PR base.
2. Commit each listed file with the pull request title as the commit message.
3. Open a pull request from that branch into the primary branch.
4. Return the host URL in the modal.

On **GitLab** this is a merge request. On **Bitbucket** it is a pull request. The Coop button label is **Create pull request** on every host.

Nothing is created if you cancel, if files are empty, or if the host rejects the request (permission, missing repo, or a duplicate PR for the same branch).

## Code hosts

Create pull request uses the **same** GitHub, GitLab, or Bitbucket connection your org admin already made in the [admin portal](https://admin.coop-ai.dev/integrations). You do not create a token, paste a PAT, or change App permissions to open a PR.

| Host | What Coop opens |
| --- | --- |
| **GitHub** | Pull request |
| **GitLab** | Merge request (same **Create pull request** button) |
| **Bitbucket** | Pull request |

If the host is not connected yet, your admin clicks **Connect** on that card — the same flow as indexing. Developers do not connect a code host in VS Code in production. See [GitHub](/docs/github).

## After the PR is open

- **Browser** — Use **Open on GitHub** (or the URL in the success modal) to add reviewers, CI, or extra description.
- **Extension UI** — Keep chatting in the same thread. Creating a PR does not undo the applied patch.
- **Undo** on the patch card still restores the editor files; it does **not** close the PR or delete the branch on the host.

To open a second PR from a later `/edit`, apply that patch and click **Create pull request** again. If `coop/patch` already has an open PR, change **Branch** in the modal (for example `coop/patch-docs`) so GitHub does not reject a duplicate.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **No Create pull request button** | Apply the patch first. The button only appears on **Patch applied**, not on the pending Apply / Reject row. |
| **Pick a Use-repo before creating a pull request** | Click **Use repo** on the repository in the Remote workspace picker, then retry. |
| **Apply the patch first, then create a pull request** | Click **Apply** on the patch card so Coop has file contents to commit. |
| **Permission / cannot create** | Ask your admin to confirm **Integrations** shows **Connected** for this host. Do not create a personal token. See [GitHub](/docs/github). |
| **GitHub rejected this pull request (422)** | GitHub refused the request — often because a PR already exists for this branch. Change **Branch** in the modal and retry. |
| **GitHub could not find the repository or branch** | Confirm **Use repo** matches a repo your admin indexed. Ask them to include it when they connected GitHub. |
| **Notes empty or still “Generating summary…”** | Notes are optional. You can submit without them, or wait a few seconds and edit the draft. |
| **Cancel created nothing** | Expected — **Cancel**, Escape, or the backdrop does not create a branch, commit, or PR. |

More fixes: [Troubleshooting](/docs/troubleshooting).

## Next steps

- [Edit mode](/docs/edit-mode) — generate and apply patches
- [GitHub](/docs/github) — admin Connect in the portal
- [Owner's Manual — Create a pull request](/manual#create-a-pull-request)
