"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import {
  fetchSamlMetadataXml,
  fetchSsoConfig,
  fetchSsoPolicy,
  ssoStartUrl,
  updateSsoConfig,
  updateSsoPolicy,
  type SsoConfigInput,
  type SsoConfigResponse,
  type SsoPolicyResponse,
  type SsoSpDetails
} from "@/lib/coopApi";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";

type Provider = SsoConfigInput["provider"];

function providerLabel(provider?: string): string {
  switch (provider) {
    case "okta":
      return "Okta";
    case "azuread":
      return "Azure AD / Entra ID";
    case "saml":
      return "SAML 2.0";
    default:
      return "Identity provider";
  }
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

  const [provider, setProvider] = useState<Provider>("okta");
  const [idpEntityId, setIdpEntityId] = useState("");
  const [idpSsoUrl, setIdpSsoUrl] = useState("");
  const [idpX509Cert, setIdpX509Cert] = useState("");
  const [hasCertificate, setHasCertificate] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState(false);
  const [requireSsoConfirmOpen, setRequireSsoConfirmOpen] = useState(false);

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

    const input: SsoConfigInput = {
      provider,
      idpEntityId: idpEntityId.trim(),
      idpSsoUrl: idpSsoUrl.trim(),
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
    setMessage("SSO saved. Use Test sign-in before requiring SSO for everyone.");
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
            <a href={ssoStartUrl(orgName)} className="admin-btn-secondary">
              Test sign-in
            </a>
          ) : null}
          {configured && !editing ? (
            <button type="button" className="admin-btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : null}
        </div>
      </div>

      {sp ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white">1. Coop service provider</p>
              <p className="mt-1 text-sm text-coop-muted">
                Add these values in your identity provider&apos;s SAML application.
              </p>
            </div>
            <button type="button" className="admin-btn-secondary" onClick={() => void handleDownloadMetadata()}>
              Download metadata
            </button>
          </div>
          <div className="space-y-3">
            <CopyField label="Entity ID" value={sp.entityId} />
            <CopyField label="ACS URL" value={sp.acsUrl} />
            <CopyField label="Metadata URL" value={sp.metadataUrl} />
          </div>
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
            <p className="text-sm font-medium text-white">2. Identity provider</p>
            <p className="mt-1 text-sm text-coop-muted">
              Paste the Entity ID, SSO URL, and signing certificate from your IdP.
            </p>
          </div>

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
          </div>

          <div>
            <label htmlFor="sso-entity" className="admin-label">
              IdP Entity ID
            </label>
            <input
              id="sso-entity"
              className="admin-input"
              value={idpEntityId}
              disabled={saving}
              onChange={(event) => setIdpEntityId(event.target.value)}
              placeholder="https://idp.example.com/…"
              required
            />
          </div>

          <div>
            <label htmlFor="sso-url" className="admin-label">
              IdP SSO URL
            </label>
            <input
              id="sso-url"
              className="admin-input"
              value={idpSsoUrl}
              disabled={saving}
              onChange={(event) => setIdpSsoUrl(event.target.value)}
              placeholder="https://idp.example.com/sso/saml"
              required
            />
          </div>

          <div>
            <label htmlFor="sso-cert" className="admin-label">
              Signing certificate
            </label>
            {hasCertificate && !idpX509Cert ? (
              <p className="mb-1.5 text-xs text-coop-muted">Certificate on file. Leave blank to keep it, or paste a new one to replace.</p>
            ) : null}
            <textarea
              id="sso-cert"
              className="admin-input min-h-[7rem]"
              value={idpX509Cert}
              disabled={saving}
              onChange={(event) => setIdpX509Cert(event.target.value)}
              placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"}
              required={!hasCertificate}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              className="accent-coop-index"
              checked={enabled}
              disabled={saving}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable SSO for this organization
          </label>

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
          <p className="text-sm font-medium text-white">2. Identity provider</p>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-coop-muted">Provider</dt>
              <dd className="text-white">{providerLabel(config?.provider)}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-coop-muted">Entity ID</dt>
              <dd className="min-w-0 break-all font-mono text-xs text-white/90">{config?.idpEntityId}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-coop-muted">SSO URL</dt>
              <dd className="min-w-0 break-all font-mono text-xs text-white/90">{config?.idpSsoUrl}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-coop-muted">Certificate</dt>
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
              Test SSO first. Then require it when you&apos;re ready to turn off password and Google sign-in.
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
          working with <strong className="text-white">Test sign-in</strong> first — a misconfigured
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
