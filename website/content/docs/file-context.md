---
title: File context — remote vs local
description: How to tell whether Coop is attaching a remote (codehost) file or a local workspace file in chat.
section: extension
order: 2
lastUpdated: "2026-07-21"
---

The composer **file chip** is the universal indicator for which file Coop is attaching as context — and whether that attachment is **remote** (codehost / indexed repo) or **local** (your disk / editor buffer).

<!-- figures md -->
![Remote file chip in the Coop chat composer — Dockerfile labeled raneyja/Coop-AI](/screenshots/docs/extension-remote-file-chip.png)
<!-- /figures -->

*Remote attachment: the chip shows the filename plus `owner/repo` (here `Dockerfile` · `raneyja/Coop-AI`). That label is how you know Coop is using remote/codehost context.*

## Read the chip

| Chip label | Meaning |
| --- | --- |
| **`filename` · `owner/repo`** (e.g. `Dockerfile` · `raneyja/Coop-AI`) | **Remote** — Coop is attaching this path as codehost / indexed-repo context |
| **`filename` · Local Workspace** | **Local** — Coop is attaching the open editor / on-disk workspace file |
| **No file chip** | No active file is attached (repo-only scope, or you removed the chip) |

Do not rely on the VS Code tab path alone (`~/Desktop/...`). The editor can show a local clone while the Coop chip still says remote — or the reverse. **Trust the chip.**

## How a remote chip appears

Any of these attach a **remote** chip (filename + `owner/repo`):

1. **Open a file** in a workspace that maps to your indexed / primary repo — Coop auto-seeds the chip as remote-first when owner/repo are known.
2. **Remote workspace** — click the **folder** icon in the composer, browse the remote tree, and select a file.
3. **`@` search** — pick a hit from an indexed repo (not Local Workspace).

You can remove the chip with **×**. That drops the explicit file mention for the next send; open another file or pick again to re-attach.

## How a local chip appears

A **Local Workspace** chip means Coop is scoping that path to your local folder / buffer:

- The open file is outside a known codehost repo, or remote graph is unavailable for your plan
- You `@`-mentioned a local workspace search hit
- You dismissed a remote chip and only local scope remains

Local chips still send live editor content (including unsaved edits) when the tab is open.

## Related controls (not the remote indicator)

| UI | Role |
| --- | --- |
| **Folder** icon in the composer | Opens **Remote workspace** browse — a way to *pick* remote files; the **chip** is still what proves remote is attached |
| **Paperclip** | Attach images / PDFs / extra files — not the remote vs local file indicator |
| **✓ AGENTS.md** | Project instructions loaded every turn — separate from the file chip |
| **Settings → Workspace** | Primary repo and branch for repo-wide quick actions |

## Quick checklist

1. Look at the composer chip before you send.
2. See `owner/repo` → remote context.
3. See **Local Workspace** (or no file chip) → local / no remote file attachment.
4. Need a different remote file? Folder icon or `@` — confirm the chip updates.

Daily walkthrough: [Owner's Manual — File context chips](/manual#file-context-chips). Workspace defaults: [Extension settings](/docs/extension-settings#workspace).
