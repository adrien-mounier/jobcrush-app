import { test } from "@playwright/test";
test("debug", async ({ page }) => {
  await page.route("**/api/sessions/me", async (route) => { await route.fulfill({ json: { ok: true } }); });
  function fact(id: string, i: number) {
    return { id, text: `Fact ${i}.`, colour: i % 3 === 0 ? "gold" : "grey", source: "told", job: null };
  }
  const state = {
    factCount: 17,
    search: { role: null, family: null, siblingTitles: [], openJobs: null },
    contact: { phone: null, email: null },
    location: { area: null, workRights: null },
    languagesQuestion: { questionId: "x", question: "x", consequence: null, options: ["English","Ask me later"], answer: null },
    domains: [
      { tag: "experience", heading: "Professional Experience", facts: Array.from({ length: 12 }, (_, i) => fact(`e${i}`, i)) },
      { tag: "skill", heading: "Skills", facts: Array.from({ length: 3 }, (_, i) => fact(`s${i}`, i)) },
      { tag: "cert", heading: "Certifications", facts: Array.from({ length: 2 }, (_, i) => fact(`c${i}`, i)) },
    ],
  };
  await page.route("**/api/profile", async (route) => { await route.fulfill({ json: state }); });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Constellation" }).click();
  const lis = page.locator(".skylist li");
  const count = await lis.count();
  const pts = [];
  for (let i = 0; i < count; i++) {
    const style = (await lis.nth(i).getAttribute("style")) ?? "";
    pts.push(style);
  }
  console.log(JSON.stringify(pts, null, 1));
});
