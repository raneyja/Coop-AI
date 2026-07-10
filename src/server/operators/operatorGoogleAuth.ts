import { GoogleAuthService } from "../auth/googleAuthService";
import type { OperatorAuthConfig } from "./operatorAuthConfig";
import { isAllowedOperatorGoogleRedirectUri } from "./operatorAuthConfig";
import type { OperatorStore } from "./operatorStore";

export type OperatorGoogleAuthDeps = {
  config: OperatorAuthConfig;
  operatorStore: OperatorStore;
};

export class OperatorGoogleAuthService {
  private readonly google: GoogleAuthService | undefined;

  public constructor(private readonly config: OperatorAuthConfig) {
    if (config.googleClientId && config.googleClientSecret) {
      this.google = new GoogleAuthService({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        stateSecret: config.oauthStateSecret
      });
    }
  }

  public isConfigured(): boolean {
    return Boolean(this.google);
  }

  public buildAuthorizeUrl(redirectUri: string, postLoginRedirect?: string): string | undefined {
    if (!this.google) {
      return undefined;
    }
    const normalizedRedirect = redirectUri.trim().replace(/\/$/, "");
    if (!isAllowedOperatorGoogleRedirectUri(this.config, normalizedRedirect)) {
      return undefined;
    }
    return this.google.buildAuthorizeUrl(normalizedRedirect, {
      mode: "login",
      redirect: postLoginRedirect
    });
  }

  public async exchangeCodeForSession(
    deps: OperatorGoogleAuthDeps,
    code: string,
    redirectUri: string
  ): Promise<
    | { ok: true; token: string; expiresAt: Date; operator: { id: string; email: string; name?: string; role: string } }
    | { ok: false; status: number; error: string; message: string }
  > {
    if (!this.google) {
      return {
        ok: false,
        status: 503,
        error: "operator_google_unavailable",
        message: "Operator Google sign-in is not configured."
      };
    }

    const normalizedRedirect = redirectUri.trim().replace(/\/$/, "");
    if (!isAllowedOperatorGoogleRedirectUri(this.config, normalizedRedirect)) {
      return {
        ok: false,
        status: 400,
        error: "invalid_redirect_uri",
        message: "OAuth redirect URI is not allowed for operator sign-in."
      };
    }

    let profile;
    try {
      profile = await this.google.exchangeCode(code, normalizedRedirect);
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: "google_exchange_failed",
        message: err instanceof Error ? err.message : "Google sign-in failed."
      };
    }

    if (!profile.emailVerified) {
      return {
        ok: false,
        status: 403,
        error: "email_not_verified",
        message: "Google account email must be verified."
      };
    }

    if (!this.config.allowlistEmails.has(profile.email)) {
      return {
        ok: false,
        status: 403,
        error: "operator_not_allowlisted",
        message: "This email is not authorized for operator access."
      };
    }

    const operator = await deps.operatorStore.upsertOperatorFromGoogle({
      email: profile.email,
      name: profile.name,
      googleSub: profile.sub,
      defaultRole: deps.config.defaultRole
    });

    if (operator.disabledAt) {
      return {
        ok: false,
        status: 403,
        error: "operator_disabled",
        message: "This operator account has been disabled."
      };
    }

    const session = await deps.operatorStore.createSession(operator.id, this.config.sessionTtlMs);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      operator: {
        id: operator.id,
        email: operator.email,
        name: operator.name,
        role: operator.role
      }
    };
  }
}
