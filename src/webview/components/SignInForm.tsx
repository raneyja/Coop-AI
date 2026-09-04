import React, { useState } from "react";

type AccountAuthStep = "choose" | "password";

export type SignInFormProps = {
  onSignInGoogle: () => void;
  onSignInPassword: (email: string, password: string) => void;
  onSignInSso: (org?: string) => void;
  onForgotPassword: (email: string) => void;
  /** Settings-only note about where keys live. Hidden on the chat homepage. */
  showStorageNote?: boolean;
};

function GoogleMark(): React.ReactElement {
  return (
    <svg className="coop-auth-google-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AuthDivider(): React.ReactElement {
  return (
    <div className="coop-auth-divider" role="separator">
      <span className="coop-auth-divider-line" aria-hidden="true" />
      <span className="coop-auth-divider-text">or</span>
      <span className="coop-auth-divider-line" aria-hidden="true" />
    </div>
  );
}

export function SignInForm({
  onSignInGoogle,
  onSignInPassword,
  onSignInSso,
  onForgotPassword,
  showStorageNote = true
}: SignInFormProps): React.ReactElement {
  const [emailDraft, setEmailDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [ssoOrgDraft, setSsoOrgDraft] = useState("");
  const [authStep, setAuthStep] = useState<AccountAuthStep>("choose");

  const trimmedEmail = emailDraft.trim();

  const submitPasswordSignIn = () => {
    onSignInPassword(trimmedEmail, passwordDraft);
    setPasswordDraft("");
  };

  const continueWithEmail = () => {
    if (!trimmedEmail) {
      return;
    }
    setAuthStep("password");
  };

  const backToChoose = () => {
    setAuthStep("choose");
    setPasswordDraft("");
  };

  if (authStep === "password") {
    return (
      <>
        <p className="coop-prompt-modal-section-title">Sign in</p>
        <button type="button" className="coop-text-btn mb-1" onClick={backToChoose}>
          ← Use a different email
        </button>
        <p className="coop-settings-card-desc">{trimmedEmail}</p>
        <label className="coop-settings-field-row mt-3">
          <span className="coop-settings-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={passwordDraft}
            className="coop-settings-field"
            onChange={(event) => setPasswordDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitPasswordSignIn();
              }
            }}
          />
        </label>
        <div className="coop-auth-stack mt-3">
          <button type="button" className="coop-auth-btn coop-auth-btn--primary" onClick={submitPasswordSignIn}>
            Sign in
          </button>
          <button type="button" className="coop-text-btn self-center" onClick={() => onForgotPassword(trimmedEmail)}>
            Forgot password?
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="coop-prompt-modal-section-title">Sign in</p>
      <p className="coop-settings-card-desc">Continue to your Coop account.</p>

      <div className="coop-auth-stack mt-3">
        <button type="button" className="coop-auth-btn" onClick={onSignInGoogle}>
          <GoogleMark />
          Continue with Google
        </button>
      </div>

      <AuthDivider />

      <label className="coop-settings-field-row">
        <span className="coop-settings-label">Email address</span>
        <input
          type="email"
          autoComplete="username"
          value={emailDraft}
          placeholder="Email address"
          className="coop-settings-field"
          onChange={(event) => setEmailDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              continueWithEmail();
            }
          }}
        />
      </label>
      <div className="coop-auth-stack mt-2">
        <button
          type="button"
          className="coop-auth-btn coop-auth-btn--primary"
          onClick={continueWithEmail}
          disabled={!trimmedEmail}
        >
          Continue with email
        </button>
      </div>

      <AuthDivider />

      <label className="coop-settings-field-row">
        <span className="coop-settings-label">Organization name</span>
        <input
          type="text"
          autoComplete="organization"
          value={ssoOrgDraft}
          placeholder="Acme Engineering"
          className="coop-settings-field"
          onChange={(event) => setSsoOrgDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ssoOrgDraft.trim()) {
              onSignInSso(ssoOrgDraft.trim());
            }
          }}
        />
      </label>
      <div className="coop-auth-stack mt-2">
        <button
          type="button"
          className="coop-auth-btn"
          onClick={() => onSignInSso(ssoOrgDraft.trim() || undefined)}
        >
          Sign in with SSO
        </button>
      </div>

      {showStorageNote ? (
        <p className="coop-settings-card-desc mt-3">
          LLM provider keys are routed server-side; code host tokens stay in VS Code SecretStorage.
        </p>
      ) : null}
    </>
  );
}
