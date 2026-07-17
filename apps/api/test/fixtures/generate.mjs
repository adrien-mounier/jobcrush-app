// One-shot generator for the JC-12 extraction fixtures (run: node test/fixtures/generate.mjs).
// The binaries are committed so tests and CI never need pdf-lib/jszip at runtime. All CVs are
// fictional people.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";

const here = dirname(fileURLToPath(import.meta.url));
const out = (name) => join(here, name);

// ---------- PDF helpers ----------

async function makePdf(pagesOfLines, { interleaveColumns = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pagesOfLines) {
    const page = doc.addPage([595, 842]); // A4
    if (interleaveColumns) {
      // Hostile two-column layout: alternate draw calls between columns so the text layer's
      // natural reading order interleaves the columns.
      const [left, right] = lines;
      const rows = Math.max(left.length, right.length);
      for (let i = 0; i < rows; i++) {
        const y = 800 - i * 16;
        if (left[i]) page.drawText(left[i], { x: 40, y, size: 9, font });
        if (right[i]) page.drawText(right[i], { x: 300, y, size: 9, font });
      }
    } else {
      lines.forEach((line, i) => {
        page.drawText(line, { x: 50, y: 800 - i * 16, size: 10, font });
      });
    }
  }
  return Buffer.from(await doc.save());
}

// ---------- DOCX helpers (minimal OOXML; mammoth only needs the main document part) ----------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const p = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text) => `<w:tc><w:tcPr/><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
const row = (cells) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;

async function makeDocx(bodyXml) {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${bodyXml}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", document);
  return zip.generateAsync({ type: "nodebuffer" });
}

// ---------- Fixture 1: clean classic 2-page PDF ----------

const cleanPdf = await makePdf([
  [
    "MARIA KOWALSKI",
    "maria.kowalski@example.com | +48 600 000 000 | Warsaw, Poland",
    "",
    "PROFESSIONAL EXPERIENCE",
    "",
    "IT Project Manager - Nordic Retail Group",
    "Mar 2021 - Present",
    "- Led the replatforming of the e-commerce checkout, delivered 2 months early",
    "- Managed a budget of EUR 1.2M across 3 vendor teams",
    "- Ran steering committee reporting for the CIO",
    "",
    "Project Coordinator - Baltic Software House",
    "Jun 2017 - Feb 2021",
    "- Coordinated releases for 4 agile squads (approx. 30 engineers)",
    "- Introduced RAID logging, cutting escalations by a third",
  ],
  [
    "EDUCATION",
    "",
    "MSc Management Information Systems - University of Warsaw, 2017",
    "",
    "SKILLS",
    "",
    "Jira, MS Project, Confluence, SQL basics, Power BI",
    "PRINCE2 Practitioner (2019), PSM I (2020)",
    "",
    "LANGUAGES",
    "Polish (native), English (C1), German (B1)",
  ],
]);
await writeFile(out("clean.pdf"), cleanPdf);

// ---------- Fixture 2: LinkedIn "Save profile as PDF"-style text-layer PDF ----------

const linkedinPdf = await makePdf([
  [
    "Contact",
    "tomas.berg@example.com",
    "www.linkedin.com/in/tomasberg-example",
    "",
    "Top Skills",
    "Product Roadmapping",
    "Stakeholder Management",
    "Agile Methodologies",
    "",
    "Tomas Berg",
    "Product Owner | Fintech | Payments",
    "Stockholm, Sweden",
    "",
    "Summary",
    "Product Owner with 6 years in payments platforms.",
    "",
    "Experience",
    "",
    "Klarnify AB",
    "Product Owner",
    "January 2022 - Present (3 years 7 months)",
    "Owned the merchant onboarding backlog for 8 squads.",
    "",
    "PayNordic",
    "Business Analyst",
    "2018 - 2021 (3 years)",
    "Wrote acceptance criteria for the card-issuing API.",
    "",
    "Education",
    "KTH Royal Institute of Technology",
    "BSc, Computer Science (2014 - 2018)",
  ],
]);
await writeFile(out("linkedin-profile.pdf"), linkedinPdf);

// ---------- Fixture 3 (hostile): two-column PDF with interleaved draw order ----------

const twoColPdf = await makePdf(
  [
    [
      [
        "SKILLS",
        "Scrum / Kanban",
        "Azure DevOps",
        "Figma",
        "SQL",
        "",
        "CERTIFICATIONS",
        "CSPO 2021",
        "ITIL v4 2019",
        "",
        "CONTACT",
        "lena.fischer@example.com",
        "+49 170 0000000",
        "Berlin",
      ],
      [
        "LENA FISCHER - DIGITAL PRODUCT MANAGER",
        "",
        "EXPERIENCE",
        "Digital Product Manager, UrbanMobility GmbH",
        "2020 - present",
        "- Shipped the multi-city ticketing app (1.5M MAU)",
        "- Defined OKRs with 4 engineering leads",
        "",
        "Product Analyst, RideData UG",
        "2016 - 2020",
        "- Built the KPI dashboard used by the exec team",
        "- A/B tested onboarding, +12% activation",
      ],
    ],
  ],
  { interleaveColumns: true },
);
await writeFile(out("two-column.pdf"), twoColPdf);

// ---------- Fixture 4 (hostile): scanned-image PDF — no text layer at all ----------

{
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  // A grey rectangle stands in for the scan bitmap; the point is: zero extractable text.
  page.drawRectangle({ x: 40, y: 60, width: 515, height: 720, color: rgb(0.85, 0.85, 0.85) });
  await writeFile(out("scanned.pdf"), Buffer.from(await doc.save()));
}

// ---------- Fixture 5: clean DOCX ----------

const cleanDocx = await makeDocx(
  [
    p("DAVID NGUYEN"),
    p("david.nguyen@example.com | Ho Chi Minh City"),
    p(""),
    p("WORK EXPERIENCE"),
    p("Scrum Master - SaigonSoft (2019 - 2024)"),
    p("- Facilitated ceremonies for 3 squads shipping a banking app"),
    p("- Tracked velocity and coached the PO on backlog hygiene"),
    p("Developer - MekongTech (2015 - 2019)"),
    p("- Built internal tools in C#"),
    p(""),
    p("EDUCATION"),
    p("BEng Software Engineering, HCMUT, 2015"),
    p(""),
    p("SKILLS"),
    p("Scrum, Jira, C#, SQL Server, English (IELTS 7.0)"),
  ].join(""),
);
await writeFile(out("clean.docx"), cleanDocx);

// ---------- Fixture 6 (hostile): table-based DOCX layout ----------

const tableDocx = await makeDocx(
  [
    p("PRIYA RAMAN"),
    `<w:tbl><w:tblPr/><w:tblGrid/>`,
    row(["EXPERIENCE", ""]),
    row(["2021-2025", "Technical Project Manager, CloudWorks India - migrated 40 apps to AWS"]),
    row(["2017-2021", "Systems Engineer, InfraCore - ran the on-call rotation for payments infra"]),
    row(["EDUCATION", ""]),
    row(["2013-2017", "BTech Information Technology, Anna University"]),
    row(["SKILLS", ""]),
    row(["", "AWS, Terraform, Jira, MS Project, stakeholder reporting"]),
    `</w:tbl>`,
    p(""),
    p("priya.raman@example.com | Chennai"),
  ].join(""),
);
await writeFile(out("table-based.docx"), tableDocx);

// ---------- Fixture 7: plain text ----------

await writeFile(
  out("plain.txt"),
  [
    "Ahmed El-Sayed",
    "Cairo, Egypt - ahmed.elsayed@example.com",
    "",
    "Experience",
    "Delivery Manager, NileWare (2020-)",
    "* Ran delivery for two enterprise accounts",
    "* Set up capacity planning across 5 teams",
    "",
    "IT Support Lead, PyramidNet (2016-2020)",
    "* Managed a team of 6",
    "",
    "Education",
    "BSc Computer Science, Cairo University (2016)",
    "",
    "Skills",
    "ITIL, Jira, ServiceNow, Arabic (native), English (fluent)",
    "",
  ].join("\n"),
  "utf8",
);

console.log("fixtures written to", here);
