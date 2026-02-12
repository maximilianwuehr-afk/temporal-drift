// ============================================================================
// Google Auth - Reusable OAuth Session
// ============================================================================

import crypto from "crypto";
import { requestUrl } from "obsidian";

import { runLoopbackOAuthCodeFlow } from "./oauth-loopback";
import { GoogleOAuthToken } from "./types";

interface GoogleAuthSessionOptions {
  scope: string | string[];
  token: GoogleOAuthToken | null;
  getClientId: () => string;
  getClientSecret?: () => string;
  onTokenUpdate: (token: GoogleOAuthToken | null) => Promise<void>;
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Base64Url(input: string): string {
  return base64Url(crypto.createHash("sha256").update(input).digest());
}

export class GoogleAuthSession {
  private token: GoogleOAuthToken | null;
  private readonly options: GoogleAuthSessionOptions;

  constructor(options: GoogleAuthSessionOptions) {
    this.options = options;
    this.token = options.token;
  }

  updateToken(token: GoogleOAuthToken | null): void {
    this.token = token;
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  getToken(): GoogleOAuthToken | null {
    return this.token ? { ...this.token } : null;
  }

  async beginAuthFlow(openUrl: (url: string) => void): Promise<void> {
    const clientId = this.options.getClientId().trim();
    if (!clientId) {
      throw new Error("Missing Google Client ID");
    }

    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = sha256Base64Url(verifier);

    const { code, redirectUri } = await runLoopbackOAuthCodeFlow({
      openUrl,
      buildAuthUrl: (resolvedRedirectUri) =>
        this.buildAuthUrl({
          clientId,
          redirectUri: resolvedRedirectUri,
          codeChallenge: challenge,
        }),
    });

    await this.exchangeAuthCode({ code, redirectUri, verifier, clientId });
  }

  async disconnect(): Promise<void> {
    this.token = null;
    await this.options.onTokenUpdate(null);
  }

  async getAccessToken(): Promise<string> {
    if (!this.token) throw new Error("Not authenticated");

    // Refresh if expires in the next 5 minutes.
    if (Date.now() > this.token.expires_at - 300_000) {
      await this.refreshToken();
    }

    return this.token.access_token;
  }

  private buildAuthUrl(opts: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
  }): string {
    const scope = Array.isArray(this.options.scope) ? this.options.scope.join(" ") : this.options.scope;

    return (
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(opts.clientId)}&` +
      `redirect_uri=${encodeURIComponent(opts.redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scope)}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `code_challenge=${encodeURIComponent(opts.codeChallenge)}&` +
      `code_challenge_method=S256`
    );
  }

  private async exchangeAuthCode(opts: {
    code: string;
    redirectUri: string;
    verifier: string;
    clientId: string;
  }): Promise<void> {
    const body = new URLSearchParams({
      client_id: opts.clientId,
      code: opts.code,
      code_verifier: opts.verifier,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    });

    const clientSecret = this.options.getClientSecret?.().trim();
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = response.json as any;
    const next: GoogleOAuthToken = {
      access_token: String(data.access_token ?? ""),
      refresh_token: String(data.refresh_token ?? this.token?.refresh_token ?? ""),
      expires_at: Date.now() + Number(data.expires_in ?? 0) * 1000,
    };

    this.token = next;
    await this.options.onTokenUpdate(next);
  }

  private async refreshToken(): Promise<void> {
    if (!this.token?.refresh_token) throw new Error("No refresh token");

    const clientId = this.options.getClientId().trim();
    if (!clientId) throw new Error("Missing Google Client ID");

    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: this.token.refresh_token,
      grant_type: "refresh_token",
    });

    const clientSecret = this.options.getClientSecret?.().trim();
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = response.json as any;
    const next: GoogleOAuthToken = {
      ...this.token,
      access_token: String(data.access_token ?? ""),
      expires_at: Date.now() + Number(data.expires_in ?? 0) * 1000,
    };

    this.token = next;
    await this.options.onTokenUpdate(next);
  }
}
