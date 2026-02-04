/**
 * GitHub 2FA Extension Types
 */

export type PendingVerification = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string; // One-click URL with code pre-filled
  expiresAt: string;
  intervalMs: number;
};

/**
 * Trusted session - persistent trust that doesn't expire.
 * Requires 2FA to enable, can be revoked by "disable trust" command.
 */
export type TrustedSession = {
  sessionKey: string;
  githubLogin: string;
  enabledAt: string;
};

export type SessionStore = {
  version: 2;
  pending: Record<string, PendingVerification>;
  trusted: Record<string, TrustedSession>;
};

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string; // URL with code pre-filled - just click to approve
  expires_in: number;
  interval: number;
};

export type DeviceTokenResponse =
  | {
      access_token: string;
      token_type: string;
      scope?: string;
    }
  | {
      error: string;
      error_description?: string;
      error_uri?: string;
    };
