// ============================================================================
// Google Auth - Shared Types
// ============================================================================

export interface GoogleOAuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret?: string;
}
