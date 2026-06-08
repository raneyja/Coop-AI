# CoopAI Marketing Website

Marketing site for [coop-ai.dev](https://coop-ai.dev), built with **Next.js 15**, **Tailwind CSS**, and deployed on **Vercel**.

This folder is self-contained — it does not share dependencies with the VS Code extension at the repo root.

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Home — hero, features, testimonial, trust badges |
| `/product` | Product capabilities and quick actions |
| `/enterprise` | Zero-retention, BYOK, enterprise features |
| `/pricing` | Pricing tiers (placeholder during beta) |
| `/security` | Security architecture and honest trust posture |
| `/privacy` | Privacy Policy |
| `/terms` | Terms of Service |
| `/demo` | Book a demo + extension waitlist forms |
| `/docs` | Documentation placeholder (coming soon) |
| `/blog` | Blog index |
| `/blog/[slug]` | Individual blog posts (Markdown in `content/blog/`) |

## Local development

```bash
cd website
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

1. Push this repo to GitHub
2. In [Vercel](https://vercel.com), import the repository
3. Set **Root Directory** to `website`
4. Add environment variables (see below)
5. Connect domain `coop-ai.dev` in Vercel → Settings → Domains

Vercel auto-detects Next.js. No custom build config needed.

## `www` subdomain (redirect to apex)

Canonical site URL is **`https://coop-ai.dev`**. `www.coop-ai.dev` redirects there (see `website/vercel.json`).

### Vercel (domains + redirect)

1. **Project → Settings → Domains**
2. Click **Add** and enter `www.coop-ai.dev`
3. If Vercel offers **“Redirect www.coop-ai.dev to coop-ai.dev”**, accept it (same as the `vercel.json` rule).
4. If both domains show as connected, you’re done after DNS propagates.

### DNS (at your registrar, e.g. Squarespace, Cloudflare, Namecheap)

| Host | Type | Value |
|------|------|--------|
| `@` (apex) | `A` | `76.76.21.21` (or what Vercel shows for `coop-ai.dev`) |
| `www` | `CNAME` | `cname.vercel-dns.com` (or the exact target Vercel lists for `www`) |

Use the records Vercel displays on the Domains page—they override generic examples if they differ.

### Deploy the redirect rule

After `vercel.json` changes, **Deployments → ⋯ → Redeploy** (or push to Git).

### Verify

- `https://www.coop-ai.dev` → should land on `https://coop-ai.dev`
- `https://www.coop-ai.dev/demo` → `https://coop-ai.dev/demo`

To use **www as primary** instead, swap host/destination in `vercel.json` and set `site.config.ts` `url` to `https://www.coop-ai.dev`.

## Environment variables

Copy `.env.example` to `.env.local` for local dev, and add the same keys in Vercel → Settings → Environment Variables.

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_SHEETS_WEBHOOK_URL` | Recommended | Google Apps Script web app URL for form submissions |
| `NEXT_PUBLIC_TAWK_PROPERTY_ID` | Optional | [Tawk.to](https://tawk.to) property ID (free live chat) |
| `NEXT_PUBLIC_TAWK_WIDGET_ID` | Optional | Tawk.to widget ID |
| `NEXT_PUBLIC_VSCODE_MARKETPLACE_URL` | Optional | VS Code Marketplace URL when published |

### Analytics (included, no config needed)

We use **Vercel Analytics** and **Vercel Speed Insights** — free on Vercel hobby plans, privacy-friendly, no cookie banner required for basic page analytics.

---

## Google Sheets setup (waitlist + demo forms)

Form submissions POST to `/api/submit`, which forwards JSON to your Google Apps Script web app.

### Step 1 — Create a Google Sheet

Create a spreadsheet with headers in row 1:

```
timestamp | type | email | name | company | role | message | source
```

### Step 2 — Add Apps Script

In the sheet: **Extensions → Apps Script**.

1. Copy your **Spreadsheet ID** from the browser URL:  
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
2. Paste the script below and replace `PASTE_SPREADSHEET_ID_HERE`.

```javascript
// Required: paste the ID from your sheet URL (see step 2 above)
var SPREADSHEET_ID = "PASTE_SPREADSHEET_ID_HERE";

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSubmissionSheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === "PASTE_SPREADSHEET_ID_HERE") {
    throw new Error("Set SPREADSHEET_ID at the top of Code.gs to your sheet ID from the URL.");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
}

// Opening the web app URL in a browser calls doGet (health check)
function doGet() {
  return jsonResponse({ ok: true, message: "CoopAI webhook ready. POST JSON to submit." });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ error: "Expected JSON POST body (application/json)." });
    }

    var sheet = getSubmissionSheet();
    var data = JSON.parse(e.postData.contents);

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.type || "",
      data.email || "",
      data.name || "",
      data.company || "",
      data.role || "",
      data.message || "",
      data.source || "coop-ai.dev"
    ]);

    return jsonResponse({ ok: true, lastRow: sheet.getLastRow() });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}
```

**Why executions showed “Failed”:** The old script used `getActiveSpreadsheet()`, which is often **null** for web-app POSTs, so `doPost` crashed. Visiting the deployment URL in a browser calls **`doGet`**; without `doGet` defined, those runs failed too.

After changing the script: **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**.  
Updating code alone does not change the live web app until you publish a new deployment version.

### Step 3 — Deploy as web app

1. **Deploy → New deployment → Web app**
2. Execute as: **Me**
3. Who has access: **Anyone**
4. Copy the deployment URL

### Step 4 — Add to Vercel

Set `GOOGLE_SHEETS_WEBHOOK_URL` to that URL in Vercel environment variables (and `.env.local` locally).

**What I need from you:** The deployed web app URL after you complete steps 1–3. No Google OAuth or service account required with this approach.

### Troubleshooting: forms succeed but nothing in the sheet

1. **Redeploy Vercel** after adding `GOOGLE_SHEETS_WEBHOOK_URL` (env vars apply only to new deployments).
2. **Confirm the variable** in Vercel → Settings → Environment Variables → Production (not only Preview, if you test on production domain).
3. **Web app access** must be **Anyone** (not “Anyone with a Google account”) or server POSTs from Vercel will fail.
4. **Use the `/exec` URL** from Deploy → Manage deployments (not an old `/dev` test URL).
5. **Browser check:** DevTools → Network → submit the form → click `submit` → Response should be `{"ok":true}`. If `503`, the env var is missing on that deployment.
6. **Test Google directly** (replace URL):

```bash
curl -sS -X POST "YOUR_SCRIPT_WEB_APP_URL" \
  -H "Content-Type: application/json" \
  -d '{"timestamp":"2026-01-01T00:00:00.000Z","type":"waitlist","email":"test@example.com","name":"Test","company":"","role":"","message":"","source":"curl-test"}'
```

Expected response: `{"ok":true}`. Then check row 2+ in the sheet.

7. **Test Vercel API** (replace host):

```bash
curl -sS -X POST "https://coop-ai.dev/api/submit" \
  -H "Content-Type: application/json" \
  -d '{"type":"waitlist","email":"test@example.com","name":"Vercel Test"}'
```

8. **Vercel logs:** Project → Logs → filter `/api/submit` for `[form] Saved to sheet` or error lines.
9. **Wrong tab:** `getActiveSheet()` writes to whichever tab was open when you saved the script—click the intended tab before redeploying, or set a fixed sheet name in the script.

**Unverified Google app:** When authorizing Apps Script, use Advanced → Go to … (unsafe) → Allow (see note above in Google setup).

---

## Tawk.to live chat (setup guide)

CoopAI’s marketing site shows a **Tawk.to** chat bubble on every page (bottom-right). The code lives in `src/components/TawkChat.tsx` and is included from `src/app/layout.tsx`.

**You do not paste Tawk’s HTML into WordPress-style “header” fields.** This is a Next.js app: you copy two IDs from Tawk into **environment variables**, then redeploy. That loads the same script Tawk gives you.

```text
Visitor on coop-ai.dev
    → page loads TawkChat
    → script from https://embed.tawk.to/{PROPERTY_ID}/{WIDGET_ID}
    → you reply in the Tawk.to dashboard or mobile app
```

---

### Part 1 — Create your Tawk account and property

1. Go to [https://tawk.to](https://tawk.to) and sign up (free tier is fine).
2. Create a **property** for your site (name it e.g. `CoopAI` or `coop-ai.dev`).
3. Under **Administration → Properties**, open the property and confirm the site URL includes **`coop-ai.dev`** (and `www.coop-ai.dev` if you use www).
4. Invite teammates under **Administration → Users** if others should answer chats.

---

### Part 2 — Copy your Property ID and Widget ID

1. In Tawk: **Administration → Channels → Chat Widget**.
2. Select your widget (often named after your site).
3. Open **Setup** or **Embed Code** (wording varies).
4. Find the line that looks like:

```javascript
s1.src='https://embed.tawk.to/6a19e3c6a95f821c31805465/1jpqi3g9b';
```

5. Copy the two path segments **after** `/embed.tawk.to/`:

| Segment | CoopAI example (yours may differ) | Put in env var |
|---------|-----------------------------------|----------------|
| Property ID (long) | `6a19e3c6a95f821c31805465` | `NEXT_PUBLIC_TAWK_PROPERTY_ID` |
| Widget ID (shorter) | `1jpqi3g9b` | `NEXT_PUBLIC_TAWK_WIDGET_ID` |

Keep this embed block somewhere safe (Notes/1Password)—you only need the two IDs for Vercel, not the full `<script>` in git.

---

### Part 3 — Add variables in Vercel

1. Open [vercel.com](https://vercel.com) → your **website** project (root directory `website`).
2. **Settings → Environment Variables → Add New**.
3. Add **both** variables below. For each one, enable **Production** and **Preview** (recommended).

| Key | Value | Sensitive? |
|-----|--------|------------|
| `NEXT_PUBLIC_TAWK_PROPERTY_ID` | your Property ID | No (public in browser) |
| `NEXT_PUBLIC_TAWK_WIDGET_ID` | your Widget ID | No |

4. Click **Save** for each.

**Important:** `NEXT_PUBLIC_` variables are embedded at **build time**. Saving them alone does not update the live site.

---

### Part 4 — Redeploy

1. **Deployments** tab.
2. On the latest deployment, **⋯ → Redeploy**.
3. Wait until status is **Ready**.

Optional: push any commit to `main` if your project auto-deploys from Git—that also picks up new env vars.

---

### Part 5 — Verify on the live site

1. Open **https://coop-ai.dev** in a normal browser window (not only localhost).
2. Look for the **chat bubble** at the bottom-right within a few seconds.
3. Click it and send a test message (e.g. “test from setup”).
4. In Tawk: **Inbox** (or **Dashboard → Chats**) — the message should appear within seconds.
5. Reply from Tawk; confirm the reply shows in the widget on the site.

**Technical check (optional):**

- **DevTools → Network** → filter `tawk` → you should see a request to `embed.tawk.to/...`.
- **View Page Source** → search for `embed.tawk.to` — if present, the install is live.

---

### Part 6 — Configure the widget (recommended)

In Tawk’s dashboard:

| Area | What to set |
|------|-------------|
| **Chat Widget → Appearance** | Colors to match CoopAI (dark theme); position bottom-right |
| **Chat Widget → Behavior** | Offline message, business hours if you use them |
| **Triggers / Knowledge Base** | Optional; skip until you need them |
| **Notifications** | Email/mobile when a visitor messages |
| **Shortcuts / Pre-chat** | Optional name/email before chat |

None of this requires code changes—only Tawk dashboard settings.

---

### Part 7 — Answer chats day-to-day

- **Web:** [dashboard.tawk.to](https://dashboard.tawk.to) → Inbox.
- **Mobile:** Tawk.to apps (iOS/Android).
- **Browser extension:** Tawk offers a Chrome extension for notifications.

Assign agents under **Administration → Users** so multiple people can respond.

---

### Local development (optional)

```bash
cd website
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_TAWK_PROPERTY_ID=your_property_id_here
NEXT_PUBLIC_TAWK_WIDGET_ID=your_widget_id_here
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the bubble should appear. Chats from localhost still show in your Tawk inbox (useful for testing).

If either variable is missing, **no widget is shown** and there is no error on the page (by design).

---

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| No bubble on coop-ai.dev | Env vars missing or deploy before vars were set | Set both vars → **Redeploy** |
| Bubble on localhost only, not production | Vars only in Preview, or no Production redeploy | Add vars for **Production** → Redeploy |
| Tawk says “Insert code on your website” | Dashboard has not detected the widget yet | Visit live site, open widget once, wait 5–15 min; ignore if bubble works |
| Bubble blocked | Ad blocker / Brave shields | Test incognito or disable blocker for coop-ai.dev |
| Script missing in page source | Build without env vars | Redeploy after vars are saved |
| Messages not in inbox | Wrong Tawk property / wrong widget | Re-check IDs match **Embed Code** URL |
| `www` vs apex | Widget only on one host | Test both URLs; both should load same layout |

---

### FAQ

**Should we paste the embed `<script>` into the codebase?**  
No. `TawkChat.tsx` already loads the same URL. Pasting again would duplicate the widget.

**Are these IDs secret?**  
No. Anyone can see them in the browser. Env vars keep config out of git and let you change IDs without a code change.

**Does this replace demo/waitlist forms?**  
No. Forms still go to Google Sheets via `/api/submit`. Chat is for live questions; forms are for structured leads.

**CoopAI production IDs (reference)** — if this doc matches your live Tawk embed:

- Property: `6a19e3c6a95f821c31805465`
- Widget: `1jpqi3g9b`

---

## VS Code Marketplace link

Until the extension is published, the site shows **"Join waitlist for extension"** instead of an install button.

When published, set:

```
NEXT_PUBLIC_VSCODE_MARKETPLACE_URL=https://marketplace.visualstudio.com/items?itemName=coop-ai.coop-ai
```

(Update the item name to match your actual listing.)

---

## Assets

| File | Source |
|------|--------|
| `public/coop-logo.png` | CoopAI mascot (header/footer) |
| `public/logo.png` | CoopAI wordmark (legacy, unused in nav) |
| `public/coop-icon.svg` | Extension icon |
| `public/screenshots/product-dark.png` | VS Code screenshot (dark) |
| `public/screenshots/product-light.png` | VS Code screenshot (light, spare) |

---

## Docs (future)

The `/docs` route is a placeholder. When ready, we can build a full docs site (Sourcegraph Cody-style) with getting started, API reference, and enterprise guides — likely as a nested route group or separate `website/docs` content layer.
