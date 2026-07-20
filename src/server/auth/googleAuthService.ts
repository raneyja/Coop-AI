import { createHmac, timingSafeEqual } from "node:crypto";

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_SCOPES = ["openid", "email", "profile"].join(" ");

export type GoogleAuthProfile = {
  sub: string;
  email: string;
  name?: string;
  emailVerified: boolean;
};

export type GoogleAuthServiceOptions = {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
};

export type GoogleAuthState = {
  redirect?: string;
  mode: "login" | "signup" | "invite";
  orgName?: string;
  plan?: "free" | "pro";
  /** One-time user_invite token when mode is "invite". */
  inviteToken?: string;
  firstName?: string;
  lastName?: string;
  timezone?: string;
  /** Unix ms when the signed state was issued (replay window). */
  iat?: number;
};

/** Signed OAuth state validity (standard SaaS OAuth CSRF window). */
export const GOOGLE_AUTH_STATE_TTL_MS = 15 * 60 * 1000;

export class GoogleAuthService {
  public constructor(private readonly options: GoogleAuthServiceOptions) {}

  public buildAuthorizeUrl(redirectUri: string, state: GoogleAuthState): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "online",
      prompt: "select_account",
      state: signGoogleAuthState(state, this.options.stateSecret)
    });
    return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
  }

  public parseState(state: string): GoogleAuthState | undefined {
    return verifyGoogleAuthState(state, this.options.stateSecret);
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<GoogleAuthProfile> {
    const tokenResponse = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: redirectUri
      }).toString()
    });
    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Google token exchange failed (${tokenResponse.status}): ${body}`);
    }
    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = String(tokenData.access_token ?? "");
    if (!accessToken) {
      throw new Error("Google token response missing access_token");
    }
    return this.fetchProfile(accessToken);
  }

  private async fetchProfile(accessToken: string): Promise<GoogleAuthProfile> {
    const response = await fetch(GOOGLE_USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "coop-ai-backend" }
    });
    if (!response.ok) {
      throw new Error(`Google userinfo failed (${response.status})`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const sub = String(data.id ?? data.sub ?? "");
    const email = String(data.email ?? "").toLowerCase();
    if (!sub || !email) {
      throw new Error("Google profile missing id or email");
    }
    return {
      sub,
      email,
      name: typeof data.name === "string" ? data.name : undefined,
      emailVerified: data.verified_email === true || data.email_verified === true
    };
  }
}

function signGoogleAuthState(state: GoogleAuthState, secret: string): string {
  const withIat: GoogleAuthState = { ...state, iat: state.iat ?? Date.now() };
  const payload = Buffer.from(JSON.stringify(withIat)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyGoogleAuthState(
  state: string,
  secret: string,
  now = Date.now()
): GoogleAuthState | undefined {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) {
    return undefined;
  }
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleAuthState;
    if (typeof parsed.iat === "number") {
      if (parsed.iat > now + 60_000 || now - parsed.iat > GOOGLE_AUTH_STATE_TTL_MS) {
        return undefined;
      }
    }
    return parsed;
  } catch {
    return undefined;
  }
}
