// Google OAuth 2.0 (authorization-code flow), ported from vitacairn's oauth.ts. No SDK — an
// auth-URL builder + one token-exchange fetch + a JWT payload decode. The id_token comes straight
// from Google's token endpoint over TLS (server-to-server, authenticated with our client secret),
// so we trust its payload without verifying the signature — it never transited the browser.
// Same account seam as magic-link verify: the caller takes the returned email and does
// upsertUser + setClaimedByUserId.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange the auth code for tokens and return the verified email, or null on any failure. */
export async function googleEmailFromCode(code: string, redirectUri: string): Promise<string | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as { id_token?: string };
  if (!tok.id_token) return null;
  const claims = decodeJwtPayload(tok.id_token);
  // email_verified is true for consumer Google accounts; reject only if explicitly false.
  if (!claims?.email || String(claims.email_verified) === "false") return null;
  return String(claims.email).toLowerCase();
}

function decodeJwtPayload(jwt: string): { email?: string; email_verified?: boolean | string } | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
