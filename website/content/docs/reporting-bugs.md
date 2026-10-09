---
title: Bug reports & feedback
description: Report a problem from VS Code, choose what diagnostics to share, and send feedback to the CoopAI team.
section: help
order: 3
lastUpdated: "2026-10-09"
---

## Report an issue from VS Code

**Availability:** In-app reporting is available in the CoopAI **0.1.13 development build**. If **Report an Issue** is missing from your installed extension, email [support@coop-ai.dev](mailto:support@coop-ai.dev).

![CoopAI Report an Issue form in VS Code, showing report type, contact email, summary, details, and optional diagnostics](/screenshots/docs/extension-report-issue.png)

1. Open the Command Palette (**Cmd+Shift+P** on macOS, **Ctrl+Shift+P** on Windows or Linux).
2. Select **CoopAI: Report an Issue**. You can also open **CoopAI Settings → Report an issue**.
3. Choose **Bug report**, **Feedback**, or **Feature request** and enter a contact email.
4. Add a summary and details. For a bug, include steps to reproduce, the expected result, and what actually happened.
5. Optionally select **Include version and platform diagnostics**, then click **Send report**.

You must be signed in to CoopAI to submit from the extension. A **Report received** confirmation means your report is saved in the support inbox for our team to review. You do not need to forward the report ID. Keep it if you want to follow up by email.

If submission fails, your draft stays in the open report panel so you can retry. Closing the panel or reloading the VS Code window discards the draft.

## What diagnostics include

Use **Preview diagnostics** to inspect the metadata before sharing it:

- CoopAI extension version
- VS Code version
- Extension host platform and CPU architecture. In a remote VS Code session, these describe the machine running the extension.

Diagnostics are optional and unchecked by default. The extension does not automatically attach source files, conversations, settings, credentials, or logs. Support operators can view the description you submit and any metadata you choose to include.

Optional diagnostic metadata expires from support access after **7 days** and is cleared by backend maintenance. Database backups follow their separate retention policy. The report description, contact information, and triage history remain available for support follow-up. Do not put passwords, tokens, private source code, or other sensitive material in the report text.

## Write a useful bug report

Tell us which CoopAI action failed and whether you can reproduce it. Include:

- The action or command you used, such as **Use repo**, **/edit**, or **Connect Slack**.
- The steps that led to the problem.
- What you expected and what happened instead.
- The exact error message, with sensitive values removed.
- Whether it happens every time or only sometimes.

For a response-quality problem, describe what was incorrect and the evidence that shows the expected behavior. Include only the smallest example you are comfortable sharing.

## Cannot sign in or submit?

Email [support@coop-ai.dev](mailto:support@coop-ai.dev) with your summary and reproduction steps. This also works for problems with the website or admin portal. Screenshots can be attached to email; the in-app form currently accepts text and optional version/platform metadata.

## Feedback and feature requests

Use the same **Report an Issue** form and change the type to **Feedback** or **Feature request**. Describe the workflow you want to improve and what would help you complete it.

For common setup problems, see [Troubleshooting](/docs/troubleshooting). For a product walkthrough, see the [Owner’s Manual](/manual).
