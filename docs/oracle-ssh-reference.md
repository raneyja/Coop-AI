# Oracle VM — SSH key reference

Keep this open while setting up the Coop API VM. Keys live on **your Mac**, not in the repo.

Full deploy guide: [deploy-oracle-always-free.md](./deploy-oracle-always-free.md)

---

## Key file locations (Mac)

| File | Path | Purpose |
|------|------|---------|
| **Private key** | `~/.ssh/coop-oracle` | Never share. Used by `ssh` on your Mac. |
| **Public key** | `~/.ssh/coop-oracle.pub` | Paste into Oracle Console when creating the instance. |

Equivalent paths:

```text
/Users/jonraney/.ssh/coop-oracle
/Users/jonraney/.ssh/coop-oracle.pub
```

---

## Terminal — generate key (one time)

Run on **your Mac** (not on Oracle):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/coop-oracle -C "coop-api" -N ""
```

| Prompt | Answer |
|--------|--------|
| Overwrite? | `y` only if you are replacing an old key |

**Success:** Both files exist:

```bash
ls -la ~/.ssh/coop-oracle ~/.ssh/coop-oracle.pub
```

---

## Terminal — copy public key for Oracle

**Option A — print to terminal** (select and copy the one line):

```bash
cat ~/.ssh/coop-oracle.pub
```

**Option B — copy to clipboard (Mac):**

```bash
pbcopy < ~/.ssh/coop-oracle.pub
```

Paste into Oracle: **Create instance** → **Add SSH keys** → paste the full line starting with `ssh-ed25519`.

---

## Browser — where to paste in OCI

1. **Compute** → **Instances** → **Create instance**
2. Scroll to **Add SSH keys**
3. Choose **Paste public key**
4. Paste the entire `ssh-ed25519 AAAA... coop-api` line
5. **Create**

---

## Terminal — connect to the VM

Replace `<PUBLIC_IP>` with the instance’s public IP from the OCI console:

```bash
ssh -i ~/.ssh/coop-oracle ubuntu@<PUBLIC_IP>
```

**First connect** — type `yes` when asked about host authenticity.

**Success:** prompt looks like `ubuntu@coop-api:~$`

---

## Terminal — optional: shorter SSH command

**File** — `~/.ssh/config` on your Mac (create or append):

```sshconfig
Host coop-oracle
  HostName <PUBLIC_IP>
  User ubuntu
  IdentityFile ~/.ssh/coop-oracle
  IdentitiesOnly yes
```

Then connect with:

```bash
ssh coop-oracle
```

Update `HostName` whenever the VM gets a new public IP.

---

## Fix permissions (if SSH refuses the key)

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/coop-oracle
chmod 644 ~/.ssh/coop-oracle.pub
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Permission denied (publickey)` | Wrong key pasted in OCI, or wrong `ubuntu@` user — Ubuntu images use user `ubuntu` |
| `No such file` | Run `ssh-keygen` command above first |
| `WARNING: UNPROTECTED PRIVATE KEY` | Run `chmod 600 ~/.ssh/coop-oracle` |
| Connection timeout | OCI security list missing ingress **TCP 22** from `0.0.0.0/0` (tighten to your IP later) |

---

## Security

- **Do not** commit `coop-oracle` or `coop-oracle.pub` to git
- **Do not** paste the **private** key (`coop-oracle` without `.pub`) anywhere
- Only the **`.pub`** file goes into Oracle Console
