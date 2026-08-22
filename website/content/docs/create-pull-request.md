---
title: Create pull request
description: Open a pull request from applied /edit patches — from the patch card or by asking in chat.
section: extension
order: 5
lastUpdated: "2026-08-22"
---

<!-- figures lg -->
![Create pull request — confirm branch, title, and AI-generated notes after applying an /edit patch](/screenshots/docs/extension-create-pull-request.png)
<!-- /figures -->

After you **Apply** an `/edit`, you can open a pull request for your team without leaving VS Code.

Two ways — both open the same confirm step (branch, title, notes). Cancel, Escape, or clicking away creates nothing.

| Way | What goes in the PR |
| --- | --- |
| **Create pull request** on a patch card | That Apply only |
| Type **Create a PR** in chat | **Every** `/edit` you Applied in this thread |

There is no `/pr` slash command. Chat understands everyday wording — “create a pull request”, “create a pr of all the work I just applied”.

## Open a pull request

### From the patch card

1. Select the repository with **Use repo**.
2. Send `/edit <instruction>` (or `/patch`, `/fix`) and click **Apply**.
3. On **Patch applied**, click **Create pull request**.
4. Review **Branch**, **Title**, and **Notes**. Edit anything you want.
5. Click **Create pull request**. Coop shows a link — open it to see the PR.

### From chat

1. Select the repository with **Use repo**.
2. Apply one or more `/edit`s in the same thread.
3. Type **Create a PR** (or “create a pull request of all the work I just applied”).
4. Review **Branch**, **Title**, and **Notes**. Notes cover every Apply in the thread.
5. Click **Create pull request**. Coop shows a link — open it to see the PR.

Chat ships **applied** `/edit`s only — not text you typed in the file. Apply first, then ask.

## Branch, title, and notes

Coop fills these in from the change. You can edit all of them.

| Field | Default | What it’s for |
| --- | --- | --- |
| **Branch** | `coop/patch` | The branch for this change. Choose a new name if you already opened a PR from `coop/patch`. |
| **Title** | `Update path/to/file` | The pull request title. Several files become `Update N files`. |
| **Notes (AI Generated)** | Short summary of the diff | The pull request description. Optional — edit, replace, or clear. |
| **Files** | That card (button) or every Apply in this thread (chat) | What goes into the PR |

Notes are drafted for you and labeled **(AI Generated)** so reviewers can tell. They describe the diff only — not tickets or tests you didn’t mention. The model is **OpenAI GPT-4o mini** ([model assignments](/docs/model-assignments)).

## After it’s open

- Open the link to add reviewers or more description on GitHub.
- Keep chatting in the same thread. Opening a PR does not undo the edit.
- **Undo** on the patch card restores the editor. It does not close the PR.

Apply as many `/edit`s as you want in the same thread, then type **Create a PR**. One pull request includes all of them. If `coop/patch` is already in review, change **Branch** so the new work gets its own PR.

## GitHub, GitLab, and Bitbucket

Coop opens a **pull request** on GitHub or Bitbucket, and a **merge request** on GitLab. The button in Coop is always **Create pull request**.

Your org connects GitHub (or GitLab / Bitbucket) once. You use that connection from the editor.

## Next steps

- [Edit mode](/docs/edit-mode) — describe a change and apply the patch
- [Owner's Manual — Create a pull request](/manual#create-a-pull-request)
