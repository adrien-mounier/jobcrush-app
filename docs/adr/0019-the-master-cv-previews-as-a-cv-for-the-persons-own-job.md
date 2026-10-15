# ADR-0019 — The master CV previews as a CV tailored to the person's own job

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decided in:** [#389](https://github.com/adrien-mounier/jobcrush-app/issues/389) item 1 (owner answer)
- **Depends on:** [ADR-0007](0007-what-prints-is-decided-per-application.md) (what prints is decided per application), [ADR-0018](0018-the-profile-is-the-master-cvs-home.md) (the profile is the master CV's home)

## Context

The profile is the master CV's editor (ADR-0018). The profile has no view that looks like the
printed CV. Only a CV tailored to one job ad prints, with the letterhead from the saved Your details
fields (#381). The owner wants to see the master CV as it would print, and to download it. Printing
every item would misrepresent it, because a real CV picks its items (ADR-0007), so a full-profile
print would run longer than anything sent.

## Decision

1. **The preview is a tailored CV, not a dump of the profile.** The profile offers "Preview as CV",
   which opens the CV the tailor makes as though the person were applying for **their own job**. That
   is the current job (no end date; if there are several, the one started latest), or else the most
   recent one. The page is drawn by the same renderer as the PDF, letterhead included, and is read-only.
2. **It downloads as the same PDF**, through the same server-side gates as an exported draft. The
   conservation lint runs on the stored document, and only confirmed facts are used.
3. **No job on the profile means no preview.** The door is shown greyed and cannot be used, with
   one line saying why. Until check mode is finished, the door is greyed in the same way.
4. **It is made once and kept.** It is remade only when the profile or that job changes. Each
   remake is one tailor call. Opening the page again never calls the model.
5. **It is an application in ADR-0007's sense, to no market.** The person's own job carries no
   job ad, so no country page applies and nothing is withheld (ADR-0007 clause 3). Its requirements
   are that job's family must-haves (the review's job placement). A job placed in no family is
   tailored to its title alone.

## Consequences

- The person sees and can keep a general-purpose CV without pasting a job ad.
- One model call per remake (the tailor's model, `preview-tailor` in `apps/api/data/ai-steps.json`).
- The two-page rule (#314) applies to it as to any tailored CV.
