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
| The repo is selected with **Use repo** and GitHub (or GitLab / Bitbucket) is connected | You only needed the edit in the editor |
| You want Coop to draft a title and notes from the diff | You will commit yourself from a local clone |

There is no `/pr` slash command. **Create pull request** appears on the **Patch applied** card after Apply.

## What you need first

1. **Extension UI** — Sign in under **Settings → Account**.
2. **Extension UI** — Click **Use repo** on the repository in the Remote workspace picker (same as [Understand Repo](/manual#understand-repo)). Settings → Workspace owner/repo alone is not enough.
3. **Admin portal** — GitHub (or GitLab / Bitbucket) connected for your org. For GitHub App installs, Contents and Pull requests must be **Read and write**, and the org must have **accepted** that permission update. See [GitHub](/docs/github).
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

Coop writes through your connected GitHub App (or GitLab / Bitbucket token) — not a local `git push` from a clone.

1. Create (or reuse) the **Branch** from the repo’s primary branch (Settings → Workspace **Primary branch**, or the Use-repo default).
2. Commit each listed file with the pull request title as the commit message.
3. Open a pull request from that branch into the primary branch.
4. Return the host URL in the modal.

On **GitLab** this is a merge request. On **Bitbucket** it is a pull request. The Coop button label is **Create pull request** on every host.

Nothing is created if you cancel, if files are empty, or if the host rejects the request (permission, missing repo, or a duplicate PR for the same branch).

## Code hosts

| Host | What Coop opens | Write access required |
| --- | --- | --- |
| **GitHub** | Pull request | GitHub App: **Contents** and **Pull requests** → **Read and write**. After Coop requests write, a GitHub org owner must **Review request / Accept** on the installation. |
| **GitLab** | Merge request | Token with `api` and `write_repository` |
| **Bitbucket** | Pull request | Token with `repository:write` and `pullrequest:write` |

**GitHub App (production):** if Create pull request returns a permission error, the App is still read-only or the org has not accepted the write update.

1. **Browser** — GitHub org → **Settings → GitHub Apps** (or `github.com/organizations/YOUR-ORG/settings/installations`) → **CoopAI for VS Code**.
2. **Accept** the pending Contents / Pull requests write request, or **Configure** → confirm the repo is in **Repository access**.
3. **Extension UI** — retry **Create pull request**.

Full GitHub connect steps: [GitHub](/docs/github).

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
| **Permission / cannot create** | GitHub App needs Contents and Pull requests **write**, and the org must accept the update. Ask your admin — see [GitHub](/docs/github). |
| **GitHub rejected this pull request (422)** | A PR may already exist for this branch. Change **Branch** in the modal and retry. |
| **GitHub could not find the repository or branch** | Confirm **Use repo** matches a repo the App can see. Add the repo under the App’s **Repository access**. |
| **Notes empty or still “Generating summary…”** | Notes are optional. You can submit without them, or wait a few seconds and edit the draft. |
| **Cancel created nothing** | Expected — **Cancel**, Escape, or the backdrop does not create a branch, commit, or PR. |

More fixes: [Troubleshooting](/docs/troubleshooting).

## Next steps

- [Edit mode](/docs/edit-mode) — generate and apply patches
- [GitHub](/docs/github) — App install and write permissions
- [Owner's Manual — Create a pull request](/manual#create-a-pull-request)
