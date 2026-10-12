// #382 (ADR-0018 clause 6) — skills one per item, in named groups, over HTTP with a fake miner that
// reads skills the way the real one does (one claim per group, rule 8). What it proves:
//   - the import splits every skills line into single skills, wording kept, grouped under the CV's
//     own group names where it names them and under the fallback where it does not;
//   - the deck's re-seed from the miner's checkpoint and a re-upload of the same CV add no skill
//     twice (the split items carry their own ids and semantic keys);
//   - renaming a group and moving a skill persist across a reload, at session doors that refuse
//     what is not theirs;
//   - the master CV and the tailored draft print from the split items: every skill once, none lost,
//     none doubled, the combined line gone — counted both ways against the CV's own list.
import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import { isTerminal } from "../src/jobs.js";
import type { LlmClient } from "../src/llm.js";
import type { ReviewState } from "../src/cvReview.js";
import { FALLBACK_GROUP } from "../src/skillsSplit.js";

type Server = ReturnType<typeof buildServer>;
type App = Server["app"];

const claim = (over: Partial<CandidateClaim> & Pick<CandidateClaim, "id" | "text">): CandidateClaim => ({
  semantic_key: over.id,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "profile",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: over.text.slice(0, 200),
  needs_grill: false,
  grill_hint: null,
  ...over,
});

// An owner-shaped skills block (invented person, the owner's layout): two groups the CV names, one
// list it does not, and a colon-introduced skill whose commas belong to it.
const DELIVERY = ["Agile / Scrum", "Roadmap and Backlog Management", "Stakeholder Management"];
const AI = [
  "Applied AI for knowledge work",
  "Prompt engineering: structured prompting, Chain-of-Thought, Tree-of-Thoughts",
  "Multi-LLM orchestration (Claude, Gemini, GPT/Codex) with sub-agents",
];
const TOOLS = ["JIRA", "Confluence", "Notion", "Splunk"];
const ALL_SKILLS = [...DELIVERY, ...AI, ...TOOLS];
const ROLE_NRG = "IT Project Manager - Nordic Retail Group";
const MINED: CandidateClaim[] = [
  claim({ id: "nrg-led-checkout", role: ROLE_NRG, text: "Led the checkout replatform, delivered 2 months early." }),
  claim({ id: "skill-delivery", text: `Delivery and governance: ${DELIVERY.join(", ")}` }),
  claim({ id: "skill-ai", text: `Applied AI: ${AI.join("; ")}` }),
  claim({ id: "skill-tools", text: `${TOOLS.join(", ")}` }),
  claim({ id: "edu-msc", role: "MSc - University of Warsaw", text: "MSc Management Information Systems, University of Warsaw." }),
];
const fakePipeline = () => ({ mine: async () => ({ doc: null, claims: MINED, roles: 1, needsGrill: 0 }) });
const CV_TEXT = "Experience\nIT Project Manager at Nordic Retail Group 2020 - 2024\n- Led the checkout replatform\nSkills\n".repeat(3);

const get = (app: App, cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
const put = (app: App, cookie: string, url: string, payload: unknown) => app.inject({ method: "PUT", url, headers: { cookie }, payload });

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
async function signIn(app: App, cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}
async function settled(app: App, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await get(app, cookie, `/jobs/${jobId}`)).json();
    if (isTerminal(job.status)) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job never settled");
}
async function paste(app: App, cookie: string): Promise<string> {
  const { jobId } = (await post(app, cookie, "/cv/paste", { text: CV_TEXT })).json();
  await settled(app, cookie, jobId);
  return jobId;
}

type Section = ReviewState["sections"][number];
const skillSection = async (app: App, cookie: string) => {
  const state = (await get(app, cookie, "/review")).json() as ReviewState;
  const s = state.sections.find((x) => x.tag === "skill") as Extract<Section, { lines: unknown }>;
  const text = new Map(s.lines.map((l) => [l.id, l.text]));
  return { lines: s.lines, groups: (s.groups ?? []).map((g) => ({ name: g.name, items: g.ids.map((id) => text.get(id)) })) };
};
/** How many times `needle` occurs in `hay` — "once" means found, and not twice. */
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

async function withCv(email = "skills@example.com", opts: Parameters<typeof buildServer>[0] = {}) {
  const server = buildServer({ pipeline: fakePipeline(), ...opts });
  const cookie = await anonSession(server.app);
  await signIn(server.app, cookie, email);
  const jobId = await paste(server.app, cookie);
  return { app: server.app, cookie, jobId };
}

describe("#382 the import splits skills one per item, in named groups", () => {
  it("every skills line becomes single skills with the wording kept, grouped under the CV's own names, the unnamed list under the fallback", async () => {
    const { app, cookie } = await withCv();
    const { lines, groups } = await skillSection(app, cookie);
    expect(lines.map((l) => l.text)).toEqual(ALL_SKILLS);
    expect(lines.every((l) => l.state === "ticked")).toBe(true);
    expect(groups).toEqual([
      { name: "Delivery and governance", items: DELIVERY },
      { name: "Applied AI", items: AI },
      { name: FALLBACK_GROUP, items: TOOLS },
    ]);
    // Not a skill, not grouped: every other section is as read.
    const state = (await get(app, cookie, "/review")).json() as ReviewState;
    const edu = state.sections.find((s) => s.tag === "edu") as Extract<Section, { lines: unknown }>;
    expect(edu.lines.map((l) => l.text)).toEqual(["MSc Management Information Systems, University of Warsaw."]);
    expect(edu.groups).toBeUndefined();
  });

  it("the deck's re-seed and a second upload of the same CV add no skill twice, and a removed skill stays removed", async () => {
    const { app, cookie, jobId } = await withCv("skills-reupload@example.com");
    const before = await skillSection(app, cookie);
    expect((await post(app, cookie, "/onboarding/deck", { jobId })).statusCode).toBe(200);
    expect((await skillSection(app, cookie)).lines.map((l) => l.id)).toEqual(before.lines.map((l) => l.id));

    const notion = before.lines.find((l) => l.text === "Notion")!;
    expect((await put(app, cookie, `/cv/lines/${notion.id}`, { state: "kept" })).statusCode).toBe(200);
    await paste(app, cookie);
    const after = await skillSection(app, cookie);
    expect(after.lines.map((l) => [l.id, l.text])).toEqual(before.lines.map((l) => [l.id, l.text]));
    expect(after.lines.find((l) => l.id === notion.id)?.state).toBe("kept");
  });
});

describe("#382 rename a group, move a skill — both persist", () => {
  it("renaming a group renames it for every skill in it; moving a skill puts it in another group; a fresh read shows both", async () => {
    const { app, cookie } = await withCv("skills-doors@example.com");
    const { lines } = await skillSection(app, cookie);

    const renamed = await put(app, cookie, `/cv/skills/groups/${encodeURIComponent(FALLBACK_GROUP)}`, { name: "Tools and platforms" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toEqual({ name: "Tools and platforms", moved: TOOLS.length });

    const stakeholders = lines.find((l) => l.text === "Stakeholder Management")!;
    const moved = await put(app, cookie, `/cv/lines/${stakeholders.id}/group`, { group: "Applied AI" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toEqual({ id: stakeholders.id, group: "Applied AI" });

    // Within a group, skills keep CV order: the moved one sits where the CV had it.
    expect((await skillSection(app, cookie)).groups).toEqual([
      { name: "Delivery and governance", items: DELIVERY.slice(0, 2) },
      { name: "Applied AI", items: ["Stakeholder Management", ...AI] },
      { name: "Tools and platforms", items: TOOLS },
    ]);
    // Grouping changes no wording and removes nothing.
    expect((await skillSection(app, cookie)).lines.map((l) => l.text)).toEqual(ALL_SKILLS);

    // The profile reads the same groups; a fact that is not a skill carries none.
    const { domains } = (await get(app, cookie, "/profile")).json() as { domains: Array<{ tag: string; facts: Array<{ text: string; group?: string }> }> };
    const facts = domains.flatMap((d) => d.facts.map((f) => ({ tag: d.tag, ...f })));
    expect(facts.filter((f) => f.tag === "skill").map((f) => [f.text, f.group])).toEqual([
      ...DELIVERY.slice(0, 2).map((t) => [t, "Delivery and governance"]),
      ["Stakeholder Management", "Applied AI"],
      ...AI.map((t) => [t, "Applied AI"]),
      ...TOOLS.map((t) => [t, "Tools and platforms"]),
    ]);
    expect(facts.find((f) => f.tag === "edu")).not.toHaveProperty("group");
    expect(facts.find((f) => f.tag === "edu")?.text).toContain("University of Warsaw");
  });

  it("refuses a group or line that is not the session's, a line that is not a skill, and an empty name", async () => {
    const { app, cookie } = await withCv("skills-refuse@example.com");
    const { lines } = await skillSection(app, cookie);
    const stranger = await anonSession(app);
    expect((await put(app, cookie, "/cv/skills/groups/No%20such%20group", { name: "x" })).statusCode).toBe(404);
    expect((await put(app, stranger, "/cv/skills/groups/Applied%20AI", { name: "x" })).statusCode).toBe(404);
    expect((await put(app, cookie, "/cv/skills/groups/Applied%20AI", { name: "  " })).statusCode).toBe(400);
    expect((await put(app, stranger, `/cv/lines/${lines[0]!.id}/group`, { group: "x" })).statusCode).toBe(404);
    expect((await put(app, cookie, "/cv/lines/nrg-led-checkout/group", { group: "x" })).statusCode).toBe(404);
    expect((await put(app, cookie, `/cv/lines/${lines[0]!.id}/group`, { group: "" })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/cv/skills/groups/Applied%20AI", payload: { name: "x" } })).statusCode).toBe(401);
    // Nothing moved.
    expect((await skillSection(app, cookie)).groups.map((g) => g.name)).toEqual(["Delivery and governance", "Applied AI", FALLBACK_GROUP]);
  });
});

// --- the renders print from the split items ---------------------------------------------------

/** A fake model that prints EVERY claim it is handed — skills in the skills block, every other
 *  claim as one bullet — so the page carries exactly what reached the tailor. Records each prompt. */
function echoingLlm(prompts: string[]): LlmClient {
  return {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const claimsBlock = (prompt.split("Claims:\n")[1] ?? "").split("\n\n")[0]!;
      const lines = [...claimsBlock.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[[^\]]*\] (.+)$/gm)];
      const bullets = lines.filter((m) => !m[1]!.startsWith("skill-")).map((m) => ({ text: m[2]!, claimIds: [m[1]!], outcome: "" }));
      const skills = lines.filter((m) => m[1]!.startsWith("skill-")).map((m) => m[2]!);
      return JSON.stringify({
        name: "Test Person",
        headline: "IT Project Manager",
        contact: "Paris",
        summary: "Delivery-accountable project manager.",
        experience: [{ role: "IT Project Manager", employer: "Nordic Retail Group", location: "", dates: "2020 - 2024", bullets, unprinted: [] }],
        skills: [{ label: "Skills", items: skills }],
        certifications: [],
        education: [],
        additional: [],
      });
    },
  };
}

describe("#382 the master CV and the tailored draft print every split skill once", () => {
  it("the master CV's Skills section holds exactly the CV's skills, one bullet each, and never the combined line", async () => {
    const { app, cookie } = await withCv("skills-master@example.com");
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200);
    const { rootCv } = (await post(app, cookie, "/onboarding/build")).json() as { rootCv: { markdown: string } };
    const skills = rootCv.markdown.split("## Skills\n\n")[1]!.split("\n\n")[0]!;
    // Both ways: every skill of the CV is a bullet, and every bullet is a skill of the CV.
    expect(skills.split("\n").map((b) => b.replace(/^- /, ""))).toEqual(ALL_SKILLS);
    for (const s of ALL_SKILLS) expect(count(rootCv.markdown, s)).toBe(1);
    expect(rootCv.markdown).not.toContain("Delivery and governance:");
  });

  it("the tailored draft's input lists every skill once, and the page carries each", async () => {
    const prompts: string[] = [];
    const server = buildServer({ pipeline: fakePipeline(), tailorLlm: echoingLlm(prompts) });
    const { app } = server;
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: "IT project manager in Paris" });
    await signIn(app, cookie, "skills-draft@example.com");
    await paste(app, cookie);
    await post(app, cookie, "/review/complete");
    await warmRetrieval(app, cookie);
    await post(app, cookie, `/onboarding/cards/${liveIdFor("2026-07-05_endava-vietnam_senior-project-manager")}/want`);
    const started = await post(app, cookie, "/onboarding/tailor/draft");
    if (started.statusCode === 202) await settled(app, cookie, started.json().jobId);
    const view = await get(app, cookie, "/onboarding/tailor/draft");
    expect(view.statusCode).toBe(200);

    const claimsBlock = (prompts[0]!.split("Claims:\n")[1] ?? "").split("\n\n")[0]!;
    const skillLines = claimsBlock.split("\n").filter((l) => /^- skill-/.test(l)).map((l) => l.replace(/^- \S+ \[[^\]]*\] /, ""));
    expect(skillLines).toEqual(ALL_SKILLS);
    for (const s of ALL_SKILLS) expect(count(claimsBlock, s)).toBe(1);
    const html = view.json().html as string;
    for (const s of ALL_SKILLS) expect(count(html, s)).toBe(1);
  });
});
