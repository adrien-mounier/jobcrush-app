# "Add something new" — the profile's way in

> **Replaced by [ADR-0017](../adr/0017-the-cv-chat-proposes-from-the-persons-own-words.md)** (2026-10-06,
> #346): the CV chat's "+ add" door on each section does this job. The date rules and the recall step
> below carry over into the chat; the three-step form is not built. Kept as the source of that wording.

- **Status:** decided 2026-09-27 in [#299](https://github.com/adrien-mounier/jobcrush-app/issues/299)
  (map [#290](https://github.com/adrien-mounier/jobcrush-app/issues/290), row V1i). **Not built.**
- **Where the build lives:** the spine spec [#301](https://github.com/adrien-mounier/jobcrush-app/issues/301),
  sliced as #316 → #317 — a decision map carries no build slices.
- **Binds:** [`docs/cv-brain/tailoring-reasoning.md`](../cv-brain/tailoring-reasoning.md) §8 clauses 7, 9
  and 10 (#287); [ADR-0003](../adr/0003-the-shared-parts-organisation-date-level.md) clause 5 (a date
  carries its own precision).
- **Why this file exists:** the decisions live on #299 and the screen wording lived in a prototype that
  has been deleted. Without this note the wording would have to be re-invented, and re-invented wording
  is how a decided design quietly becomes a different one.

## The hole it fills

A person's profile grows. She answers *"No — never used SQL"* in discovery, and in March she learns it.
#287 gave every denied capability a *"Changed? Add it"* door **on the Tailor step, at the moment a
posting asks**. This closes the other half: the person who wants to volunteer a fact with no posting in
front of her.

## The law it may not break

The profile screen shows **nothing about lack** — no list of ruled-out items, no count of them, no hint
that such a list exists (#287, *Not decided here*). That is why the flow must recognise a denial **at the
moment she types it**: it can never offer her the list to pick from.

## The container: full screen

Its own route, one question per screen, discovery's rhythm.

**The sheet was rejected on the real screen, not on paper.** The profile already owns a pull-up sheet on
phones (*Your facts*, #192). A second sheet over a screen that has one is a collision. The hybrid — sheet
that promotes to full screen for the recall step — died with it: its whole case was that only one step
needs the room, which stops being a virtue once the sheet is out.

## The door: in the hero, under the count

It wears the profile screen's own door style (`.rdoor` — the quiet gold line that *Change* and *Answer it
now* already use). **Never a floating pill:** the one that was tried landed on the *Your facts* grabber,
and nothing else on this screen floats.

| Placement | Verdict |
|---|---|
| **Hero, under "N things you've told me"** | **Chosen.** The one part of the screen that is about the collection as a whole — which is what adding to it is. The hero does not scroll away on a phone, so the door is permanent without floating. |
| End of the fact list | **Rejected — invisible on a phone.** It renders inside the *Your facts* sheet, which is closed on arrival. Measured, not assumed. |
| ＋ in the top bar | Rejected. A bare ＋ does not say add *what*; the bar already holds three controls; this screen speaks in words, not icons. |
| One door per section | **Parked as a later accelerator.** It is the screen's own idiom and it **deletes step 1** — picking where is picking what. It cannot be the entrance: the API drops a section with no facts, so a *first* certificate or a *first* language has no section to hang a door on, and that is exactly this feature's person. |

## It is a router, not a new flow

Two of the five kinds already have a better screen than a generic flow would be. The build hands off
rather than re-asking:

| Kind | Where it goes |
|---|---|
| A job | *Check your work history* (`/job-blocks`) — employer, title and dates already exist there |
| A language | *Change your languages* — the open-list door from #165, which keys the fact on her own spelling |
| **A skill** | **Nowhere today.** No row to tap, no storage. This is new build. |
| **A certificate** | **Nowhere today** — the product has no certificate concept at all. This is new build. |
| Something else | The generic path |

## The flow

Three steps, plus one interruption that only fires on a contradiction. Copy is normative — it was written
against the screen's voice (verb-first, plain, never moralising).

**1 — the kind.** *"What are you adding?"* · *"Pick the kind and I'll ask the right questions."*
Options, each with a hint: **A skill** (*A tool, a method, something you can do*) · **A job** (*A role
that wasn't on your CV*) · **A language** (*One you speak, read or write*) · **A certificate** (*A
qualification with a date on it*) · **Something else** (*Anything else your profile holds*).
The kinds list stays growable — the golden rule applies, nothing here is the owner's case hardcoded.

**2 — the thing.** One free-text box, the question worded per kind (*"What's the skill called?"*, *"Where
did you work, and as what?"*, *"Which language?"*, *"What's the certificate called?"*), under *"Your own
words are fine — I'll tidy it up."*

**2b — the recall, only when what she typed contradicts a stored "No".**
*"You told me something different before."* Then her own words back, labelled *"what you said when we
went through your languages"* (the occasion, never a system word), and: *"Nothing is wrong — people pick
things up. I just need to know which one is true now."*
Two doors of equal weight:
- **Yes — I have it now** · *I'll ask when, and put it on your CV*
- **No — I meant something else** · *Take me back to what I typed*

The second is not politeness. #287 clause 9 keeps *I tapped the wrong thing* and *I grew* as different
events — the mistap path erases the negative, the growth path keeps it. This screen is the only place she
can say which.

**3 — the date. Not one question.** See the next section.

**Done.** *"{the thing} is on your profile."* · *"{when} · it goes on your CV the next time a job asks for
it."* Then **Back to your profile** and **Add something else**. She is never shown that a negative was
kept — that is record-keeping, not her business.

## Step 3 differs by kind

The date is **asked, never stamped from today** (#287 c10). But a bucket is only right where she has no
real date:

| Kind | Asked | Why |
|---|---|---|
| A skill · a language · something else | **This year** · **1 to 2 years** · **3 years or more** | There is no day she learned SQL. A picker would only make her invent one. *"Since when?"* — *"Roughly is enough… It changes how the line reads on your CV, nothing more."* |
| A job | **Started** / **Ended**, plus *I'm still there* | She knows when she started, and a job record is two moments (ADR-0003 c5). *"When were you there?"* |
| A certificate | **The date printed on it** | It carries a real issue date. *"When were you certified?"* |

**The month is optional in both dated shapes and never padded.** "2019" is stored as a year and marked as
a year — ADR-0003 c5, the clause that exists so years-of-experience is never computed off a fabricated
January. The **year** is refused as blank where she demonstrably has it (a job's start, a certificate's
date); the month never is. A blank month is a better record than a guessed one, and the CV prints it that
way.

## What it writes

- A **Claim**, `renderable: true`, origin `user`, carrying the asked date at its real precision.
- The **Negative is kept, untouched, at its original `confirmed_date`** (#287 c9). Erasing it would make
  the record claim she always had the capability.
- Nothing is erased except on the mistap path, which is `ClaimStore.reopen`'s existing behaviour.

## The stated ceiling

Recognition matches a denial's **semantic key — its tags** (`graph.valid.json → gap-mandarin` is
`["mandarin", "language"]`). So *"MS SQL Server"* trips the stored SQL "no" and *"relational databases"*
walks straight past it. This is not solvable inside the flow. A miss is not a corruption: it produces a
true new fact sitting alongside an untouched negative, and the next posting that asks will surface both.

## Provenance

Prototyped twice on 2026-09-27. The first pass
(`apps/web/prototypes/add-something-new.prototype.html`, commits `185c299`/`cb6d109`) **drew a fake
profile screen and is superseded** — it still shows the sheet as a live option and should not be read as
the design. The second rendered the real `ProfilePage` behind a `window.fetch` stub and settled both the
container and the door; it was deleted once decided, per the throwaway rule. The lesson that generalises
is in [`lessons.md`](../../lessons.md).
