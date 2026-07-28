// E2/JC-18 email seam, mirroring llm.ts: a real provider (Resend) when RESEND_API_KEY is set, a dev
// mailer otherwise. The dev mailer sends nothing — the request-link route surfaces the link in its
// response (devLink) so local dev, CI, and the Playwright e2e can traverse signup without real email.
// `live` gates that: the link is only ever returned when NO real provider is configured.

export interface Mailer {
  /** true when a real provider is wired. When false, the login link may be returned to the client. */
  readonly live: boolean;
  sendLoginLink(email: string, url: string): Promise<void>;
  sendFamilyReady(
    email: string,
    targetRole: string,
    idempotencyKey: string,
  ): Promise<void>;
}

export class ResendMailer implements Mailer {
  readonly live = true;
  constructor(
    private apiKey: string,
    private from: string = process.env.MAIL_FROM ?? "JobCrush <login@jobcrush.app>",
  ) {}

  async sendLoginLink(email: string, url: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        from: this.from,
        to: email,
        subject: "Your JobCrush sign-in link",
        text: `Sign in to JobCrush (this link expires in 15 minutes):\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
      }),
    });
    if (!res.ok) throw new Error(`resend login-link delivery failed with status ${res.status}`);
  }
  async sendFamilyReady(email: string, targetRole: string, idempotencyKey: string) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [email],
        subject: `Credible ${targetRole} matches are ready`,
        text: `JobCrush found credible matches for ${targetRole}. Return to JobCrush to review them.`,
      }),
    });
    if (!res.ok) throw new Error(`resend family-ready delivery failed with status ${res.status}`);
  }
}

/** No provider configured (local/CI/e2e): logs the link; the route returns it so signup is traversable. */
export class DevMailer implements Mailer {
  readonly live = false;
  async sendLoginLink(email: string, url: string): Promise<void> {
    console.log(`[dev-mailer] login link for ${email}: ${url}`);
  }
  async sendFamilyReady(email: string, targetRole: string): Promise<void> {
    console.log(`[dev-mailer] family matches ready for ${email}: ${targetRole}`);
  }
}

export function mailerFromEnv(): Mailer {
  const key = process.env.RESEND_API_KEY;
  return key ? new ResendMailer(key) : new DevMailer();
}
