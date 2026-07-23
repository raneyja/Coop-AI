# Register your AI models (LLM provider keys)

**Updated:** July 9, 2026

This guide explains how to **sign up for AI services**, **create API keys**, and **hand them to whoever runs your Coop server** so chat works in the Coop AI extension.

You do **not** paste LLM keys into the extension’s **Model** settings. Model settings only choose *which* AI to use; the actual keys live on the **Coop server** (managed by your company’s admin or IT team).

---

## What you are setting up

| Piece | Who sets it up | Where |
|-------|----------------|--------|
| **API keys** for Claude, ChatGPT, Gemini, etc. | You (or your admin) create them at each AI company’s website | Given to your **Coop server administrator** — not stored in the extension |
| **Which provider and model to use** | You | Coop AI extension → **Settings** → **Model** |
| **Coop account sign-in** | You | Coop AI extension → **Settings** → **Account** (email, Google, or org SSO on Enterprise) |

Think of it like electricity: you pick which appliance to plug in (Model settings), but the power company connection (API keys) is configured at the building level (the server).

---

## Before you start

1. **Decide which AI brands you need.** Most teams only need **one** — usually **Anthropic (Claude)**, because that is Coop’s default.
2. **Create accounts** (or use your company’s existing accounts) at each provider you choose.
3. **Have a secure way to send keys** to your Coop administrator — for example your company’s password manager, encrypted email, or a secrets vault. **Do not** post keys in Slack, Teams, ticket comments, or screenshots.
4. **Know who runs your Coop server:**
   - **Coop Cloud** (`https://api.coop-ai.dev`) → your Coop account team or internal admin adds keys on the server.
   - **Self-hosted / local server** → your IT person adds keys to the server configuration (see [For IT and self-hosted teams](#for-it-and-self-hosted-teams) at the end).

---

## Which provider should I register?

| If you want to use… | Register with… | Required? |
|---------------------|----------------|-----------|
| Claude models (default in Coop) | **Anthropic** | **Yes** for most setups |
| GPT models | **OpenAI** | Only if you switch the extension to OpenAI |
| Gemini models | **Google (Gemini)** | Only if you switch the extension to Gemini |
| DeepSeek models | **DeepSeek** | Only with company legal approval |

**Minimum for a typical team:** register **Anthropic only**, leave **Settings → Model → LLM provider** on **Anthropic**, and pick a Claude model from the list.

**Lightning Mode (advanced search over code):** your administrator may also need an **OpenAI** key on the server for embeddings, even if day-to-day chat uses Claude. Ask your admin if you use Lightning.

---

## Step 1 — Create an Anthropic (Claude) API key

Anthropic powers Claude. This is the most common starting point.

1. Open **[console.anthropic.com](https://console.anthropic.com/)** in your browser.
2. **Sign in** or **create an account** (work email is fine if your company uses Anthropic).
3. If asked, complete **billing** or accept your organization’s billing setup. API usage is usually pay-as-you-go.
4. In the left menu, open **API keys** (or **Settings → API keys**).
5. Click **Create Key** (wording may be “Create API key”).
6. Give the key a **name** you will recognize later, e.g. `Coop AI – Production`.
7. **Copy the key immediately** and save it in your password manager.  
   - It often starts with `sk-ant-`.  
   - You usually **cannot** see the full key again after you close the dialog.
8. **Do not** share this key in public channels. Send it only to your Coop administrator through an approved secure method.

**You’re done with Anthropic** when you have one key copied and saved securely.

---

## Step 2 — Create an OpenAI (GPT) API key *(optional)*

Only follow this if your team plans to use **OpenAI** as the provider in **Settings → Model**, or your admin asked for OpenAI for Lightning embeddings.

1. Open **[platform.openai.com](https://platform.openai.com/)** and sign in (or create an account).
2. Complete any **billing** or organization setup OpenAI requires.
3. Go to **[platform.openai.com/api-keys](https://platform.openai.com/api-keys)**.
4. Click **Create new secret key**.
5. Name it (e.g. `Coop AI`) and create it.
6. **Copy the key** right away (often starts with `sk-`) and store it in your password manager.
7. Send it securely to your Coop administrator if they manage the server.

---

## Step 3 — Create a Google Gemini API key *(optional)*

Only follow this if your team will select **Gemini** in **Settings → Model**.

1. Open **[aistudio.google.com](https://aistudio.google.com/)** and sign in with your Google account.
2. Look for **Get API key** or **API keys** in the menu.
3. Create a key for your project (Google may ask you to create a cloud project — follow the on-screen prompts).
4. **Copy the key** and save it securely.
5. Send it securely to your Coop administrator.

---

## Step 4 — Create a DeepSeek API key *(optional, special approval)*

DeepSeek is **not** enabled for all companies by default. Check with **legal / security** before proceeding.

1. Open **[platform.deepseek.com](https://platform.deepseek.com/)** and sign in.
2. Find **API keys** in the dashboard.
3. Create and **copy** a key; store it securely.
4. Send it to your Coop administrator **together with written approval** from your security or legal team.

---

## Step 5 — Give the keys to your Coop administrator

Send a short message (through your company’s secure channel) with:

1. **Which keys you created** (e.g. “Anthropic only” or “Anthropic + OpenAI”).
2. **The key itself** (or a link from your password manager that only they can open).
3. **Which provider should be the default** (usually Anthropic).
4. **Your Coop environment** — Cloud vs self-hosted URL, if you know it.

**Example message to your admin:**

> Hi — I created API keys for Coop AI:  
> - Anthropic (Claude): [secure link or vault entry]  
> - OpenAI: not needed / attached separately  
> Please add these to our Coop server so the team can use live chat. Default provider: Anthropic.

Your administrator installs them on the server. You do not need to edit server files yourself unless you *are* the administrator (see below).

---

## Step 6 — Choose your model in the Coop AI extension

After your administrator confirms keys are on the server:

1. Open the **Coop AI** sidebar in VS Code or Cursor.
2. Click the **gear** icon for **Settings** (or run **Coop AI: Open Settings** from the Command Palette).
3. Open **Model**.
4. Set **LLM provider** to the brand you registered (e.g. **Anthropic**).
5. Pick a **Model** from the dropdown (your admin may recommend one).
6. Try a short message in chat.

If chat responds with real answers (not a placeholder or “mock” message), setup is working.

---

## How to know everything is working

| Check | What success looks like |
|-------|-------------------------|
| Extension **Model** settings | Provider and model match what your admin configured |
| Send a chat message | You get a normal AI reply, not an error about “API key” or “mock mode” |
| Ask your administrator | They can confirm the server health check shows your provider as configured |

If something fails, see [Troubleshooting](#troubleshooting).

---

## Troubleshooting

### “No API key configured” or chat never connects

- **Cause:** Keys are not on the server yet, or the wrong provider is selected in **Settings → Model**.
- **Fix:** Confirm with your administrator that keys are installed. Match **LLM provider** in the extension to a provider you actually registered (e.g. Anthropic key → Anthropic provider).

### I pasted a key into Settings → Model and it did nothing

- **Cause:** LLM keys do **not** go in Model settings.
- **Fix:** Give the key to your server administrator. Sign in under **Settings → Account** for Coop access (different from Claude/OpenAI keys).

### Chat works but answers feel fake or mention “mock”

- **Cause:** The server may be in development **mock mode** without real provider keys.
- **Fix:** Ask your administrator to add real keys and turn off mock mode.

### I only set up Anthropic but selected OpenAI in Model

- **Cause:** Provider in the extension must match a key on the server.
- **Fix:** Change **LLM provider** back to **Anthropic**, or ask your admin to add an OpenAI key.

### Billing or “quota exceeded” errors

- **Cause:** The AI provider account needs billing or has hit a spending limit.
- **Fix:** Log in to that provider’s console (Anthropic, OpenAI, etc.) and check billing and usage limits.

### Security — I accidentally shared a key publicly

1. **Revoke** the key immediately in that provider’s console (delete or rotate the key).
2. **Create a new key** and send it securely to your administrator.
3. Tell your security team if company policy requires it.

---

## Administrator: where to add your API keys

**You are in the right place if you run the Coop server** (Docker on your machine, a VPS, or Kubernetes). Keys go in **one server config file** — never in the VS Code extension.

### Step 1 — Create your secrets file

In the **Coop AI project folder** on your computer (the folder that contains `docker-compose.yml`):

1. Duplicate the template:
   ```sh
   cp .env.backend.example .env.backend
   ```
2. Open `.env.backend` in any text editor.
3. Paste each key on its own line (no quotes around the value):

   ```sh
   ANTHROPIC_API_KEY=sk-ant-paste-your-key-here
   OPENAI_API_KEY=sk-paste-your-key-here
   GEMINI_API_KEY=paste-your-gemini-key-here
   DEEPSEEK_API_KEY=paste-your-deepseek-key-here
   COOP_LLM_ALLOW_UNAPPROVED=true
   ```

4. Save the file.

| Line | What to paste |
|------|----------------|
| `ANTHROPIC_API_KEY=` | Your Anthropic (Claude) key |
| `OPENAI_API_KEY=` | Your OpenAI key |
| `GEMINI_API_KEY=` | Your Google Gemini key (or use `GOOGLE_API_KEY=` instead) |
| `DEEPSEEK_API_KEY=` | Your DeepSeek key |
| `COOP_LLM_ALLOW_UNAPPROVED=true` | Required for DeepSeek to work in Coop |

5. Make sure **`COOP_LLM_MOCK` is not set** (or set to `false`). Mock mode ignores real keys.

**Security:** `.env.backend` is git-ignored. Do not commit it or email it.

---

### Step 2 — Restart the Coop server

Pick the way you normally run the backend.

#### Option A — Docker Compose (most common)

From the project folder:

```sh
docker compose down
docker compose up --build -d
```

Docker reads keys from `.env.backend` automatically.

#### Option B — Run the server directly (no Docker)

```sh
npm run build:backend
set -a && source .env.backend && set +a
npm run start:webhooks
```

(On Windows PowerShell, load env vars your usual way, or paste them into the shell session before `npm run start:webhooks`.)

---

### Step 3 — Confirm the server sees your keys

1. Open a browser to: **http://localhost:8787/health**
2. Look for the **`llm`** section in the JSON response.
3. Success looks like:
   - `"mockMode": false`
   - `"providers"` lists `anthropic`, `openai`, `gemini`, `deepseek` (or whichever keys you added)

If `mockMode` is still `true`, the server did not load your keys — recheck `.env.backend` and restart.

---

### Step 4 — Tell your team how to connect the extension

Each developer (including you):

1. **Settings → Account**
   - Sign in with email and password, Google, or org SSO (Enterprise — org name + **Sign in with SSO**)
2. **Settings → Model** — pick provider (Anthropic, OpenAI, Gemini, or DeepSeek) and a model; keys are already on the server.
3. Send a chat message to confirm the session works.

Enterprise org admins configure SAML separately at admin portal **Settings → Single sign-on** (`/settings/single-sign-on`) — not in the extension.

For local servers, set `coopAI.apiBaseUrl` to `http://localhost:8787` in VS Code settings. Org API keys from `npm run admin:org -- create-api-key` are for automation only.

---

### Hosted production (VPS, Railway, Fly.io, etc.)

Same variable **names**, different place to paste them:

| Where you host | What to do |
|----------------|------------|
| Docker on a server | Put the same lines in `.env.backend` on the server, or in your host’s “Environment variables” UI |
| Kubernetes | Create a Secret with these keys; mount as env vars on the Coop `api` deployment |
| Coop Cloud (`api.coop-ai.dev`) | Add keys in your Coop Cloud / hosting dashboard (contact Coop support if you do not have a self-serve env UI) |

Restart the service after changing env vars.

Technical references: [webhook-backend.md](./webhook-backend.md), [api-v1.md](./api-v1.md), [zero-retention-llm.md](./zero-retention-llm.md).

---

## Quick reference — links

| Provider | Where to create keys |
|----------|----------------------|
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI (GPT) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |

| Coop extension setting | Purpose |
|------------------------|---------|
| **Settings → Model** | Choose provider and model (no LLM keys here) |
| **Settings → Account** | Sign in to Coop — not Claude/OpenAI keys |
