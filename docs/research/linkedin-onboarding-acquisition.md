# LinkedIn onboarding acquisition

Research date: 2026-07-26

## Decision

JobCrush must not turn a pasted LinkedIn public-profile URL into onboarding
evidence by scraping or by using a third-party scraper. The field proposed for
the redesigned onboarding should remain disabled and should not accept or store
a URL.

The broadly available, useful future acquisition path is a **user-uploaded
LinkedIn data archive**. A direct account connection is also possible in
principle, but its useful forms are constrained:

- LinkedIn's self-serve OpenID Connect product supplies identity-level data, not
  the employment, education, skills, or job-search history needed to skip most
  onboarding questions.
- Rich profile API access requires LinkedIn approval and remains subject to the
  permissions and restrictions of the applicable program.
- LinkedIn's Member Portability APIs can provide consenting-member data
  programmatically, but LinkedIn currently limits them to members located in the
  EU/EEA or Switzerland.

Therefore the product design should treat **archive upload** as the viable
cross-region route and **Connect LinkedIn** as a separately validated,
region/access-dependent enhancement. It should not promise that pasting a link
will import a profile.

## What each permitted route can provide

### 1. User-uploaded LinkedIn archive: viable across regions

LinkedIn lets members request a machine-readable copy of their own data from
Settings & Privacy and then transfer that copy to another controller. The
archive can include profile-relevant categories such as positions, education,
skills, certifications, projects, publications, languages, and volunteering.
It can also include job applications, saved jobs, saved job alerts, job-seeker
preferences, and other activity categories when applicable.

This makes an archive uploaded by the user the strongest documented route for
JobCrush's future needs. The initial implementation should ingest only the
categories it actively uses to skip onboarding questions. Broader job-search
signals can remain structurally possible without being requested, parsed, or
retained until a defined feature and explicit consent justify them.

Sources:

- [Download your account data — LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a1339364/downloading-your-account-data)
- [Data Portability — LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a1341547)

### 2. Sign in with LinkedIn via OIDC: permitted but insufficient for CV import

LinkedIn's self-serve OpenID Connect flow uses the `openid`, `profile`, and
optional `email` scopes. Its documented claims are an application-specific
subject identifier, name, profile picture, locale, and optionally email. It does
not expose the member's work history, education, skills, or application
activity. LinkedIn also says this sign-in product does not verify identity and
must not be marketed as doing so.

OIDC could authenticate or identify a member, but it cannot deliver the
professional evidence implied by “skip some questions.” It should not be used
to justify that promise on its own.

Source:

- [Sign In with LinkedIn using OpenID Connect — LinkedIn Developer documentation](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)

### 3. Approved Profile API access: possible, not a self-serve assumption

LinkedIn documents a Profile API for authenticated members, but explicitly
restricts it to approved developers. Calls require an access token on behalf of
the member; storage is permitted only for the authenticated member and with
their permission. Default/lite data is narrow, and additional fields require
additional permissions granted only to select partners.

JobCrush should treat useful Profile API access as a dependency to validate with
LinkedIn, not as an available implementation path. Even approved access must be
checked field by field against the program agreement before it is used for CV
evidence.

Sources:

- [Profile API — LinkedIn Developer documentation](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api)
- [Getting Access to LinkedIn APIs — LinkedIn Developer documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)

### 4. Member Portability APIs: useful direct import, region-limited

LinkedIn provides Member Portability APIs so a third-party application can,
after member consent, programmatically access the consenting member's data.
LinkedIn currently limits this functionality to members whose profile location
is in the EU/EEA or Switzerland. Members elsewhere receive an error and must use
the manual data-download route.

This could become a direct-connect path for eligible users, subject to developer
registration, the Portability API terms, authorization, consent, security, and
deletion obligations. It is not a global replacement for archive upload.

Sources:

- [Member portability APIs — LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a6214075)
- [LinkedIn DMA Portability API Terms](https://www.linkedin.com/legal/l/portability-api-terms)

## Why a pasted public-profile URL is not an acquisition path

A URL identifies a page; it does not authorize JobCrush to retrieve the
member's data. LinkedIn's User Agreement prohibits software, scripts, crawlers,
browser add-ons, or other automated means from scraping or copying profiles and
other service data. LinkedIn's API Terms also prohibit accessing, storing,
displaying, or transferring LinkedIn content obtained outside its APIs,
including content supplied indirectly by a customer or third party.

The approved Profile API works in the opposite direction: an authenticated
member authorizes an application, and LinkedIn returns data available under that
application's permissions. Its documentation derives a public URL from an
already-authorized profile response; it does not document resolving an
arbitrary public URL into profile data.

Consequently:

- User ownership of the profile does not convert its public URL into API
  authorization.
- “Publicly visible” does not mean “permitted for automated import.”
- A third-party scraping provider does not cure the restriction.
- The product must not collect a URL while implying that it is queued for
  processing.

Sources:

- [LinkedIn User Agreement, section 8.2](https://www.linkedin.com/legal/user-agreement)
- [LinkedIn API Terms of Use, sections 3–5](https://www.linkedin.com/legal/l/api-terms-of-use)
- [Profile API — LinkedIn Developer documentation](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api)

## Access, consent, and lifecycle constraints

For a future API integration:

1. Register the application and obtain access to the exact LinkedIn product and
   permissions needed. Most non-open permissions and partner programs require
   explicit LinkedIn approval.
2. Use member authorization (three-legged OAuth). LinkedIn requires applications
   to request the minimum scopes necessary; a member consents to all requested
   scopes together.
3. Before authentication, disclose what data is collected, its purpose, timing,
   disclosure, withdrawal mechanism, and deletion mechanism, and obtain a clear
   affirmative consent.
4. Keep API-derived content identifiable and selectively deletable, retain it
   only as long as necessary, and delete it when the user requests deletion or
   closes their JobCrush account.
5. Ask for new consent when the use or disclosure materially expands. Future
   application or job-search activity should therefore be added only when
   JobCrush has a concrete use for it—not requested speculatively during the
   initial profile import.
6. Let users edit any facts prefilled from LinkedIn. LinkedIn's API Terms require
   a prominent privacy notice and editability for prefilled content.

Sources:

- [LinkedIn 3-legged OAuth flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [Getting Access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
- [LinkedIn API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use)

## Truthful copy for the disabled field

Recommended presentation:

> **LinkedIn profile**
>
> Direct LinkedIn import — Coming soon

The control should be visually disabled and non-interactive. Supporting helper
copy may say:

> LinkedIn import isn't available yet. Upload a CV or start the questions
> instead.

Do not label the field “Paste your LinkedIn profile link,” because the
documented future paths may be account authorization or archive upload rather
than URL ingestion. Do not say “Connect your LinkedIn” until JobCrush has
confirmed access to a suitable API product. Do not claim that JobCrush will
automatically read a public profile.

## Design implication

Preserve the progressive-reveal interaction, but model LinkedIn as a capability
rather than a URL:

- **Now:** disabled LinkedIn row marked “Coming soon”; active CV upload; visible
  route to start questions.
- **First viable LinkedIn release:** likely accept a member's LinkedIn data
  archive, with clear category-level consent and minimal ingestion.
- **Later, if approved and useful:** offer authorized direct connection for the
  exact regions and fields supported; keep archive upload as the fallback.
- **Future matching signals:** add job applications or job-search activity only
  with a defined use, explicit consent, data minimization, and deletion controls.

This preserves future capacity without collecting unused permissions or data
today.
