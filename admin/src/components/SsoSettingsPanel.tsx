"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import {
  fetchSamlMetadataXml,
  fetchSsoConfig,
  fetchSsoPolicy,
  ssoTestConnectionUrl,
  updateSsoConfig,
  updateSsoPolicy,
  type SsoConfigInput,
  type SsoConfigResponse,
  type SsoPolicyResponse,
  type SsoSpDetails
} from "@/lib/coopApi";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { readSsoCertFile } from "@/lib/readSsoCertFile";

type Provider = SsoConfigInput["provider"];

type SsoTestResult =
  | { status: "passed"; email: string; provider?: string }
  | { status: "failed"; message: string; error?: string };

type ProviderFieldCopy = {
  label: string;
  /** Short note under the field — where this value appears in the IdP UI. */
  hint?: string;
  placeholder?: string;
};

type ProviderCopy = {
  name: string;
  /** Section 1 heading — values leave Coop and go into the IdP. */
  spTitle: string;
  /** How to paste Coop SP values into the IdP. */
  spIntro: string;
  spEntityId: string;
  spAcsUrl: string;
  spMetadataUrl: string;
  /** Section 2 heading — values come back from the IdP into Coop. */
  idpTitle: string;
  /** How to paste IdP values back into Coop. */
  idpIntro: string;
  idpEntityId: ProviderFieldCopy;
  idpSsoUrl: ProviderFieldCopy;
  idpCertificate: ProviderFieldCopy;
};

function providerLabel(provider?: string): string {
  return providerCopy(provider).name;
}

function providerCopy(provider?: string): ProviderCopy {
  if (provider === "okta") {
    return {
      name: "Okta",
      spTitle: "1. Copy into Okta",
      spIntro:
        "Required. In Okta Admin → Applications → your SAML app → Configure SAML, paste these Coop values into Okta. Without them Okta cannot send assertions back to Coop.",
      spEntityId: "Audience URI (SP Entity ID)",
      spAcsUrl: "Single sign-on URL",
      spMetadataUrl: "Metadata URL (optional)",
      idpTitle: "2. Paste from Okta",
      idpIntro:
        "After Okta is configured, open Sign On → View SAML setup instructions and paste the three values back into Coop.",
      idpEntityId: {
        label: "Identity Provider Issuer",
        hint: "Okta calls this Identity Provider Issuer.",
        placeholder: "http://www.okta.com/exk…"
      },
      idpSsoUrl: {
        label: "Identity Provider Single Sign-On URL",
        hint: "Okta calls this Identity Provider Single Sign-On URL.",
        placeholder: "https://your-org.okta.com/app/…/sso/saml"
      },
      idpCertificate: {
        label: "X.509 Certificate",
        hint: "Paste from Okta setup instructions, or Upload file with the downloaded certificate.",
        placeholder: "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"
      }
    };
  }

  if (provider === "azuread") {
    return {
      name: "Azure AD / Entra ID",
      spTitle: "1. Copy into Microsoft Entra",
      spIntro:
        "Required. In Entra → Enterprise applications → your app → Single sign-on → SAML → Basic SAML Configuration, paste these Coop values into Entra. Without them Entra cannot send assertions back to Coop.",
      spEntityId: "Identifier (Entity ID)",
      spAcsUrl: "Reply URL (Assertion Consumer Service URL)",
      spMetadataUrl: "Metadata URL (optional)",
      idpTitle: "2. Paste from Microsoft Entra",
      idpIntro:
        "After Entra is configured, copy Login URL, Microsoft Entra Identifier, and Certificate (Base64) back into Coop.",
      idpEntityId: {
        label: "Microsoft Entra Identifier",
        hint: "Must be https://sts.windows.net/{tenant-id}/ — not the Login URL.",
        placeholder: "https://sts.windows.net/…/"
      },
      idpSsoUrl: {
        label: "Login URL",
        hint: "Must be https://login.microsoftonline.com/{tenant-id}/saml2 — not sts.windows.net.",
        placeholder: "https://login.microsoftonline.com/…/saml2"
      },
      idpCertificate: {
        label: "Certificate (Base64)",
        hint: "In Entra → SAML Certificates → Download Certificate (Base64). Prefer Upload file below — macOS opens .cer in Keychain if you double-click it.",
        placeholder: "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"
      }
    };
  }

  return {
    name: provider === "saml" ? "SAML 2.0" : "Identity provider",
    spTitle: "1. Copy into your IdP",
    spIntro:
      "Required. Paste these Coop service-provider values into your identity provider's SAML application so it can send assertions back to Coop.",
    spEntityId: "Entity ID / Audience",
    spAcsUrl: "ACS URL / Reply URL",
    spMetadataUrl: "Metadata URL",
    idpTitle: "2. Paste from your IdP",
    idpIntro: "Paste your IdP Entity ID, SSO URL, and signing certificate back into Coop.",
    idpEntityId: {
      label: "IdP Entity ID",
      placeholder: "https://idp.example.com/…"
    },
    idpSsoUrl: {
      label: "IdP SSO URL",
      placeholder: "https://idp.example.com/sso/saml"
    },
    idpCertificate: {
      label: "Signing certificate",
      placeholder: "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"
    }
  };
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; value remains selectable.
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="admin-label mb-0">{label}</span>
        <button type="button" className="admin-btn-secondary !px-2 !py-1 text-xs" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="block break-all rounded-md border border-coop-border/60 bg-coop-dark px-3 py-2 font-mono text-xs text-white/90">
        {value}
      </code>
    </div>
  );
}

export function SsoSettingsPanel() {
  const me = getStoredMe();
  const orgName = displayOrgName(me);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [config, setConfig] = useState<SsoConfigResponse | null>(null);
  const [policy, setPolicy] = useState<SsoPolicyResponse | null>(null);
  const [sp, setSp] = useState<SsoSpDetails | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SsoTestResult | null>(null);

  const [provider, setProvider] = useState<Provider>("okta");
  const [idpEntityId, setIdpEntityId] = useState("");
  const [idpSsoUrl, setIdpSsoUrl] = useState("");
  const [idpX509Cert, setIdpX509Cert] = useState("");
  const [hasCertificate, setHasCertificate] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState(false);
  const [requireSsoConfirmOpen, setRequireSsoConfirmOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const result = params.get("sso_test");
    if (result !== "passed" && result !== "failed") {
      return;
    }
    if (result === "passed") {
      setTestResult({
        status: "passed",
        email: params.get("email")?.trim() || "unknown",
        provider: params.get("provider")?.trim() || undefined
      });
    } else {
      setTestResult({
        status: "failed",
        error: params.get("error")?.trim() || undefined,
        message: params.get("message")?.trim() || "SSO connection test failed."
      });
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [configResult, policyResult] = await Promise.all([fetchSsoConfig(), fetchSsoPolicy()]);
    setLoading(false);

    if (!configResult.ok) {
      setError(configResult.error ?? "Could not load SSO configuration.");
      return;
    }
    if (!policyResult.ok) {
      setError(policyResult.error ?? "Could not load sign-in policy.");
      return;
    }

    setConfig(configResult.data ?? null);
    setPolicy(policyResult.data ?? null);
    setSp(configResult.data?.sp);

    if (configResult.data?.configured) {
      setProvider(configResult.data.provider ?? "okta");
      setIdpEntityId(configResult.data.idpEntityId ?? "");
      setIdpSsoUrl(configResult.data.idpSsoUrl ?? "");
      setHasCertificate(configResult.data.hasCertificate ?? false);
      setEnabled(configResult.data.enabled ?? true);
      setEditing(false);
    } else {
      setEditing(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveConfig(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const trimmedEntityId = idpEntityId.trim();
    const trimmedSsoUrl = idpSsoUrl.trim();
    if (provider === "azuread") {
      try {
        if (new URL(trimmedSsoUrl).hostname.toLowerCase() === "sts.windows.net") {
          setSaving(false);
          setError(
            "Login URL is the Microsoft Entra Identifier (sts.windows.net). Swap fields: Login URL should be https://login.microsoftonline.com/{tenant}/saml2."
          );
          return;
        }
      } catch {
        // server-side URL validation will catch
      }
    }

    const input: SsoConfigInput = {
      provider,
      idpEntityId: trimmedEntityId,
      idpSsoUrl: trimmedSsoUrl,
      enabled
    };
    const cert = idpX509Cert.trim();
    if (cert) {
      input.idpX509Cert = cert;
    } else if (!hasCertificate) {
      setSaving(false);
      setError("Paste the X.509 signing certificate from your identity provider.");
      return;
    }

    const result = await updateSsoConfig(input);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save SSO configuration.");
      return;
    }
    setConfig(result.data ?? null);
    setSp(result.data?.sp);
    setHasCertificate(result.data?.hasCertificate ?? Boolean(cert));
    setIdpX509Cert("");
    setEditing(false);
    setMessage("SSO saved. Use Test connection before requiring SSO for everyone.");
  }

  function handleRequireSsoToggle(checked: boolean) {
    if (checked && policy && !policy.requireSso) {
      setRequireSsoConfirmOpen(true);
      return;
    }
    void handlePolicyChange({ requireSso: checked });
  }

  async function confirmRequireSso() {
    setRequireSsoConfirmOpen(false);
    await handlePolicyChange({ requireSso: true });
  }

  async function handlePolicyChange(next: Partial<SsoPolicyResponse>) {
    if (!policy) {
      return;
    }
    setPolicySaving(true);
    setMessage(null);
    setError(null);

    const merged = { ...policy, ...next };
    const result = await updateSsoPolicy({
      requireSso: merged.requireSso,
      allowPassword: merged.allowPassword,
      allowGoogle: merged.allowGoogle
    });
    setPolicySaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not update sign-in policy.");
      return;
    }
    setPolicy(result.data ?? merged);
    setMessage(
      merged.requireSso
        ? "SSO is now required for all users."
        : "Sign-in policy updated."
    );
  }

  async function handleDownloadMetadata() {
    setMessage(null);
    setError(null);
    const result = await fetchSamlMetadataXml();
    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not download metadata.");
      return;
    }
    const blob = new Blob([result.data], { type: "application/samlmetadata+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "coop-sp-metadata.xml";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Metadata downloaded.");
  }

  if (loading) {
    return <p className="mt-4 text-sm text-coop-muted">Loading…</p>;
  }

  const configured = Boolean(config?.configured);
  const active = configured && enabled;
  const copy = providerCopy(editing || !configured ? provider : config?.provider);
  const summaryCopy = providerCopy(config?.provider);
  const spUsesLocalhost = Boolean(sp?.acsUrl.includes("localhost") || sp?.acsUrl.includes("127.0.0.1"));

  return (
    <div className="mt-4 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <StatusBadge
            connected={active}
            showWhenDisconnected
            label={active ? "Enabled" : configured ? "Disabled" : "Not configured"}
          />
          {configured ? (
            <p className="text-sm text-coop-muted">
              {providerLabel(config?.provider)}
              {config?.updatedAt ? ` · Updated ${new Date(config.updatedAt).toLocaleDateString()}` : ""}
            </p>
          ) : (
            <p className="text-sm text-coop-muted">Connect your identity provider to enable SAML sign-in.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {active ? (
            <a
              href={ssoTestConnectionUrl(orgName)}
              className="admin-btn-secondary"
              title="Validates your IdP configuration without changing your Coop session"
            >
              Test connection
            </a>
          ) : null}
          {configured && !editing ? (
            <button type="button" className="admin-btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : null}
        </div>
      </div>

      {testResult?.status === "passed" ? (
        <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
          SSO connection works. Your IdP returned a valid assertion for{" "}
          <span className="font-mono text-white">{testResult.email}</span>
          {testResult.provider ? ` (${testResult.provider})` : ""}. Your admin session was not changed —
          users still sign in via the login page with Continue with SSO.
        </div>
      ) : null}
      {testResult?.status === "failed" ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          SSO connection failed
          {testResult.error ? ` (${testResult.error})` : ""}. {testResult.message}
        </div>
      ) : null}
      {active ? (
        <p className="text-xs text-coop-muted">
          Test connection opens your IdP, checks that Coop can validate the response, then returns you here.
          It does not sign you in as another user.
        </p>
      ) : null}

      {editing || !configured ? (
        <div>
          <label htmlFor="sso-provider" className="admin-label">
            Provider
          </label>
          <select
            id="sso-provider"
            className="admin-input"
            value={provider}
            disabled={saving}
            onChange={(event) => setProvider(event.target.value as Provider)}
          >
            <option value="okta">Okta</option>
            <option value="azuread">Azure AD / Entra ID</option>
            <option value="saml">Generic SAML 2.0</option>
          </select>
          <p className="mt-1.5 text-xs text-coop-muted">
            Field labels below match {copy.name}&apos;s admin console so you can paste without translating names.
          </p>
        </div>
      ) : null}

      {sp ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white">{copy.spTitle}</p>
              <p className="mt-1 text-sm text-coop-muted">{copy.spIntro}</p>
            </div>
            <button type="button" className="admin-btn-secondary" onClick={() => void handleDownloadMetadata()}>
              Download metadata
            </button>
          </div>
          <div className="space-y-3">
            <CopyField label={copy.spAcsUrl} value={sp.acsUrl} />
            <CopyField label={copy.spEntityId} value={sp.entityId} />
            <CopyField label={copy.spMetadataUrl} value={sp.metadataUrl} />
          </div>
          {spUsesLocalhost ? (
            <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              These SP values use localhost. Identity providers cannot send SAML responses to localhost; use
              hosted Coop or ask your Coop operator to expose the API through a public URL.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="admin-panel-inset">
          <p className="text-sm font-medium text-white">Service provider URLs unavailable</p>
          <p className="mt-1 text-sm text-coop-muted">
            Ask your Coop operator to set the API public base URL, then reload this page.
          </p>
        </div>
      )}

      {editing || !configured ? (
        <form onSubmit={(event) => void handleSaveConfig(event)} className="space-y-4">
          <div>
            <p className="text-sm font-medium text-white">{copy.idpTitle}</p>
            <p className="mt-1 text-sm text-coop-muted">{copy.idpIntro}</p>
          </div>

          <div>
            <label htmlFor="sso-entity" className="admin-label">
              {copy.idpEntityId.label}
            </label>
            {copy.idpEntityId.hint ? (
              <p className="mb-1.5 text-xs text-coop-muted">{copy.idpEntityId.hint}</p>
            ) : null}
            <input
              id="sso-entity"
              className="admin-input"
              value={idpEntityId}
              disabled={saving}
              onChange={(event) => setIdpEntityId(event.target.value)}
              placeholder={copy.idpEntityId.placeholder}
              required
            />
          </div>

          <div>
            <label htmlFor="sso-url" className="admin-label">
              {copy.idpSsoUrl.label}
            </label>
            {copy.idpSsoUrl.hint ? (
              <p className="mb-1.5 text-xs text-coop-muted">{copy.idpSsoUrl.hint}</p>
            ) : null}
            <input
              id="sso-url"
              className="admin-input"
              value={idpSsoUrl}
              disabled={saving}
              onChange={(event) => setIdpSsoUrl(event.target.value)}
              placeholder={copy.idpSsoUrl.placeholder}
              required
            />
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="sso-cert" className="admin-label mb-0">
                {copy.idpCertificate.label}
              </label>
              <label className={`admin-btn-secondary !px-2 !py-1 text-xs ${saving ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
                Upload file
                <input
                  type="file"
                  accept=".cer,.crt,.pem,.cert,application/x-x509-ca-cert,application/pkix-cert,application/x-pem-file,text/plain"
                  className="sr-only"
                  disabled={saving}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) {
                      return;
                    }
                    void (async () => {
                      try {
                        const pem = await readSsoCertFile(file);
                        setIdpX509Cert(pem);
                        setError(null);
                        setMessage(`Loaded certificate from ${file.name}.`);
                      } catch (err) {
                        setMessage(null);
                        setError(err instanceof Error ? err.message : "Could not read that certificate file.");
                      }
                    })();
                  }}
                />
              </label>
            </div>
            {hasCertificate && !idpX509Cert ? (
              <p className="mb-1.5 text-xs text-coop-muted">
                Certificate on file. Leave blank to keep it, or upload / paste a new one to replace.
              </p>
            ) : copy.idpCertificate.hint ? (
              <p className="mb-1.5 text-xs text-coop-muted">{copy.idpCertificate.hint}</p>
            ) : null}
            <textarea
              id="sso-cert"
              className="admin-input min-h-[7rem]"
              value={idpX509Cert}
              disabled={saving}
              onChange={(event) => setIdpX509Cert(event.target.value)}
              placeholder={copy.idpCertificate.placeholder}
              required={!hasCertificate}
            />
          </div>

          <label
            className={`flex items-center gap-2 text-sm text-white ${
              policy?.requireSso && enabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"
            }`}
            title={
              policy?.requireSso && enabled
                ? "Turn off Require SSO before disabling SAML sign-in."
                : undefined
            }
          >
            <input
              type="checkbox"
              className="accent-coop-index"
              checked={enabled}
              disabled={saving || Boolean(policy?.requireSso && enabled)}
              onChange={(event) => {
                if (!event.target.checked && policy?.requireSso) {
                  return;
                }
                setEnabled(event.target.checked);
              }}
            />
            Enable SSO for this organization
          </label>
          {policy?.requireSso && enabled ? (
            <p className="text-xs text-coop-muted">
              Turn off <span className="text-white/90">Require SSO</span> in sign-in policy before
              disabling SSO.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="admin-btn-primary" disabled={saving}>
              {saving ? "Saving…" : configured ? "Save changes" : "Save SSO"}
            </button>
            {configured ? (
              <button
                type="button"
                className="admin-btn-secondary"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setIdpX509Cert("");
                  setError(null);
                  void load();
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-white">{summaryCopy.idpTitle}</p>
          <dl className="space-y-3 text-sm">
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-coop-muted">Provider</dt>
              <dd className="text-white">{providerLabel(config?.provider)}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-coop-muted">{summaryCopy.idpEntityId.label}</dt>
              <dd className="min-w-0 break-all font-mono text-xs text-white/90">{config?.idpEntityId}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-coop-muted">{summaryCopy.idpSsoUrl.label}</dt>
              <dd className="min-w-0 break-all font-mono text-xs text-white/90">{config?.idpSsoUrl}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-coop-muted">{summaryCopy.idpCertificate.label}</dt>
              <dd className="text-white">{hasCertificate ? "On file" : "Missing"}</dd>
            </div>
          </dl>
        </div>
      )}

      {policy && configured ? (
        <div className="space-y-3 border-t border-coop-border/40 pt-6">
          <div>
            <p className="text-sm font-medium text-white">3. Sign-in policy</p>
            <p className="mt-1 text-sm text-coop-muted">
              Run Test connection first. Then require SSO when you&apos;re ready to turn off password and
              Google sign-in.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-coop-border/50 px-4 py-3 hover:bg-white/[0.03]">
            <input
              type="checkbox"
              className="mt-1 accent-coop-index"
              checked={policy.requireSso}
              disabled={policySaving || !active}
              onChange={(event) => handleRequireSsoToggle(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-white">Require SSO</span>
              <span className="mt-1 block text-sm text-coop-muted">
                All users must sign in through your identity provider.
              </span>
            </span>
          </label>

          {!policy.requireSso ? (
            <div className="space-y-2 pl-1">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-white">
                <input
                  type="checkbox"
                  className="accent-coop-index"
                  checked={policy.allowPassword}
                  disabled={policySaving}
                  onChange={(event) => void handlePolicyChange({ allowPassword: event.target.checked })}
                />
                Allow email and password
              </label>
              <label className="flex cursor-pointer items-center gap-3 text-sm text-white">
                <input
                  type="checkbox"
                  className="accent-coop-index"
                  checked={policy.allowGoogle}
                  disabled={policySaving}
                  onChange={(event) => void handlePolicyChange({ allowGoogle: event.target.checked })}
                />
                Allow Google
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <Modal
        open={requireSsoConfirmOpen}
        title="Require SSO for everyone?"
        onClose={() => setRequireSsoConfirmOpen(false)}
      >
        <p className="text-sm text-coop-muted">
          Users will no longer be able to sign in with email/password or Google. Make sure SSO is
          working with <strong className="text-white">Test connection</strong> first — a misconfigured
          IdP can lock your entire organization out of Coop.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="admin-btn-secondary"
            disabled={policySaving}
            onClick={() => setRequireSsoConfirmOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn-primary"
            disabled={policySaving}
            onClick={() => void confirmRequireSso()}
          >
            {policySaving ? "Saving…" : "Require SSO"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
