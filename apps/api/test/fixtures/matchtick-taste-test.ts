import type { AdRequirementV1, AdRequirementsV1 } from "@jobcrush/contracts";
import type { ScoredFact } from "../../src/matchtick.js";

type Requirement = Omit<AdRequirementV1, "id" | "sourceSpan"> & { sourceSpan?: string };

// #102: every ad needs language + familyFit now — set once here rather than at all 17 call sites
// below. sourceSpan defaults to the requirement text itself: these are #14's recovered throwaway
// harness ads, reconstructed from memory rather than read from a real advert, so there is no better
// provenance to record than the requirement's own wording.
const ad = (adId: string, requirements: Requirement[]): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId,
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.9 },
  requirements: requirements.map((requirement, index) => ({
    id: `${adId}-${index}`,
    sourceSpan: requirement.requirement,
    ...requirement,
  })),
});

// Exact 17 hand-derived requirement arrays from #14's recovered throwaway harness. Together with
// the three original repo fixtures below, these reproduce docs/card-quality-taste-test.md's 20 ads.
export const DERIVED_TASTE_TEST_ADS: AdRequirementsV1[] = [
  ad("schneider-electric", [
    { band: "essential", requirement: "Lead end-to-end execution of customer projects" },
    { band: "essential", requirement: "Manage budgets, timelines, and cross-functional teams" },
    { band: "essential", requirement: "Conduct risk assessments and mitigation strategies" },
    {
      band: "standard",
      requirement:
        "Foster customer relationships through clear communication and stakeholder engagement",
    },
    {
      band: "standard",
      requirement: "Ensure adherence to quality standards and compliance requirements",
    },
    { band: "nice-to-have", requirement: "Drive operational efficiency and cost reduction" },
  ]),
  ad("hays", [
    { band: "essential", requirement: "Front office project management and business analysis duties" },
    { band: "essential", requirement: "Lead gathering and documenting business requirements" },
    {
      band: "essential",
      requirement: "Oversee communication and governance among diverse stakeholder groups",
    },
    { band: "standard", requirement: "8+ years operations BA/PM experience at a top bank" },
    { band: "nice-to-have", requirement: "AI and automation projects exposure" },
    { band: "nice-to-have", requirement: "Knowledge of financial products" },
  ]),
  ad("transunion", [
    {
      band: "essential",
      requirement: "Manage multiple concurrent projects end-to-end from initiation through delivery",
    },
    {
      band: "essential",
      requirement: "Define project scope, priorities, deliverables, dependencies, and target dates",
    },
    { band: "essential", requirement: "Identify, track, and mitigate project risks and issues" },
    {
      band: "standard",
      requirement: "Manage vendor onboarding, relationships, contracts, and performance",
    },
    { band: "standard", requirement: "Oversee CapEx and OpEx financial management" },
    {
      band: "standard",
      requirement: "Use project management tools including Jira, Confluence, SharePoint",
    },
    { band: "nice-to-have", requirement: "Define and manage Agile epics, user stories, and sprints" },
  ]),
  ad("computershare", [
    { band: "essential", requirement: "Lead end-to-end business readiness for a mobile app launch" },
    {
      band: "essential",
      requirement:
        "Ensure business prepared across regulatory, legal, operational and client-facing environments",
    },
    {
      band: "essential",
      requirement: "Drive readiness planning, governance, documentation, reporting and decision-making",
    },
    {
      band: "standard",
      requirement: "Partner with stakeholders across Product, Technology, Legal, Operations",
    },
    { band: "nice-to-have", requirement: "Local regulatory execution such as ICP and app registration" },
  ]),
  ad("hire-feed", [
    {
      band: "essential",
      requirement: "Manage assigned projects from initiation to completion within scope, budget, and timelines",
    },
    {
      band: "essential",
      requirement: "Coordinate with internal teams and external stakeholders to gather requirements",
    },
    {
      band: "standard",
      requirement: "Monitor project progress through updates, risk assessments, and mitigation",
    },
    {
      band: "standard",
      requirement: "Prepare and present detailed project reports to clients and senior management",
    },
    {
      band: "nice-to-have",
      requirement: "Proficiency in project management tools such as Asana, Trello, or Jira",
    },
  ]),
  ad("okx", [
    { band: "essential", requirement: "Drive high-impact cross-functional strategic initiatives" },
    {
      band: "essential",
      requirement: "Structure complex business problems and leverage data and AI-assisted workflows",
    },
    {
      band: "standard",
      requirement: "Partner with senior leadership to translate strategies into execution",
    },
    {
      band: "standard",
      requirement: "Support operational scaling and organizational effectiveness through automation",
    },
    {
      band: "nice-to-have",
      requirement: "Background from technology, consulting, fintech, or platform environments",
    },
  ]),
  ad("synpulse", [
    {
      band: "essential",
      requirement: "Lead and manage full project lifecycles for data warehouse and migration initiatives",
    },
    {
      band: "essential",
      requirement: "Coordinate with internal stakeholders, technology teams, and external vendors",
    },
    {
      band: "essential",
      requirement: "Monitor project risks, issues, and dependencies with timely resolution",
    },
    {
      band: "standard",
      requirement: "Drive governance, documentation, and reporting to steering committees",
    },
    { band: "standard", requirement: "Led end-to-end large scale transformation projects" },
    { band: "nice-to-have", requirement: "Strong background in Wealth Management and Private Banking" },
  ]),
  ad("bnp-reg-reporting", [
    {
      band: "essential",
      requirement:
        "Manage end-to-end regulatory reporting projects, milestones, dependencies, resource allocation",
    },
    { band: "essential", requirement: "Drive regular, clear communication with all stakeholders" },
    {
      band: "essential",
      requirement: "Apply IT project governance model, change control, and post implementation reviews",
    },
    {
      band: "standard",
      requirement: "Ensure deliverables meet quality and standards preserving system stability",
    },
    {
      band: "standard",
      requirement: "Gather and translate regulatory requirements into project plans and timelines",
    },
    { band: "nice-to-have", requirement: "Perform in-depth analysis to support business cases" },
  ]),
  ad("charterhouse", [
    { band: "essential", requirement: "Own end-to-end requirements across the programme lifecycle" },
    {
      band: "essential",
      requirement:
        "Lead and facilitate discovery workshops across business, operations, technology, compliance",
    },
    {
      band: "essential",
      requirement:
        "Act as primary interface between business stakeholders, technology teams, and payments SMEs",
    },
    {
      band: "standard",
      requirement:
        "Produce Business Requirements Documents, Functional Specifications, User Stories, Process Maps",
    },
    {
      band: "standard",
      requirement: "Support UAT planning, execution, defect management, and validation",
    },
    { band: "nice-to-have", requirement: "8+ years as a Business Analyst or Product Manager" },
  ]),
  ad("mri-software", [
    {
      band: "essential",
      requirement: "Define project scope, objectives, and deliverables in collaboration with stakeholders",
    },
    {
      band: "essential",
      requirement: "Lead cross-functional teams to deliver projects on time and within budget",
    },
    {
      band: "essential",
      requirement: "Identify potential risks early and develop mitigation strategies",
    },
    {
      band: "standard",
      requirement: "Establish governance frameworks and ensure compliance with organizational standards",
    },
    {
      band: "standard",
      requirement: "Communicate effectively with executives, clients, and internal teams",
    },
    { band: "nice-to-have", requirement: "Project Management certification such as PMP or PRINCE2" },
    { band: "nice-to-have", requirement: "Mentor junior project managers and team members" },
  ]),
  ad("pwc-australia", [
    {
      band: "essential",
      requirement: "Lead end-to-end delivery across onboarding and risk assessment redesign",
    },
    {
      band: "essential",
      requirement: "Lead multi-discipline programs partnering with stakeholders across internal functions",
    },
    {
      band: "essential",
      requirement: "Translate complex risk and operational challenges into clear problem statements",
    },
    {
      band: "standard",
      requirement: "Support development of business requirements, scope, and acceptance criteria",
    },
    {
      band: "standard",
      requirement: "Lead operating model design for streamlined onboarding pathways",
    },
    {
      band: "nice-to-have",
      requirement: "Align global standards, regulatory obligations, and local business requirements",
    },
  ]),
  ad("sanderson-ikas", [
    {
      band: "essential",
      requirement: "Lead requirements gathering, user story preparation, and workflow design",
    },
    {
      band: "essential",
      requirement:
        "Drive deliverables end-to-end: feasibility, requirement analysis, documentation, UAT, implementation",
    },
    {
      band: "standard",
      requirement: "Partner with UX designers on wireframes, prototypes, and design reviews",
    },
    {
      band: "standard",
      requirement: "Experience in digital transformation across mobile and web",
    },
    { band: "nice-to-have", requirement: "Experience in Banking and Financial Services industry" },
  ]),
  ad("bnp-drive", [
    {
      band: "essential",
      requirement: "Frame the project upfront and define governance to lead the project to success",
    },
    {
      band: "essential",
      requirement: "Build and maintain the project plan, manage dependencies and critical path",
    },
    {
      band: "essential",
      requirement:
        "Drive the project team to completion with effective communication and stakeholder alignment",
    },
    {
      band: "standard",
      requirement:
        "Consolidate solution design with signoff from clients, IT architecture, and contributors",
    },
    {
      band: "standard",
      requirement: "Secure staffing of the project team with support of line managers",
    },
    {
      band: "nice-to-have",
      requirement: "Perform project retrospective to leverage experience and learn lessons",
    },
  ]),
  ad("generic-pm", [
    { band: "essential", requirement: "Deliver projects on time and within budget" },
    { band: "essential", requirement: "Manage stakeholders and communication" },
    { band: "standard", requirement: "Coordinate cross-functional teams" },
    { band: "nice-to-have", requirement: "Strong organizational skills" },
  ]),
  ad("cert-heavy-finance", [
    { band: "essential", requirement: "Hold a PMP or PRINCE2 project management certification" },
    {
      band: "essential",
      requirement: "Manage large-scale banking system implementation projects",
    },
    {
      band: "essential",
      requirement: "Deliver executive-level SteerCo reporting to senior sponsors",
    },
    { band: "standard", requirement: "Own project budget and financial management" },
    { band: "nice-to-have", requirement: "Degree in finance or business" },
  ]),
  ad("agile-tooling", [
    { band: "essential", requirement: "Lead Agile and Scrum delivery with ceremonies and sprints" },
    { band: "essential", requirement: "Use JIRA, Confluence, and Microsoft Project for tracking" },
    { band: "essential", requirement: "Coordinate technical delivery teams and vendors" },
    { band: "standard", requirement: "Manage release schedules and resource allocation" },
    { band: "nice-to-have", requirement: "Software development lifecycle understanding" },
  ]),
  ad("exec-comms", [
    { band: "essential", requirement: "Deliver executive-level communication and SteerCo reporting" },
    {
      band: "essential",
      requirement: "Own budget uplift and business case refresh for the program",
    },
    {
      band: "essential",
      requirement: "Manage third-party vendors and system integrators against SOWs",
    },
    {
      band: "standard",
      requirement: "Coordinate multiple workstreams, sequencing, and interdependencies",
    },
    { band: "nice-to-have", requirement: "Operate in complex, challenging stakeholder environment" },
  ]),
];

// Exact three representative CVs from the same recovered #14 harness.
export const TASTE_TEST_CVS: Record<"strong" | "average" | "weak", ScoredFact[]> = {
  strong: [
    { text: "Owned a project budget of $3M with vendor oversight and contract negotiation." },
    {
      text: "Led multiple cross-functional delivery teams across three vendors and system integrators.",
    },
    {
      text: "Reported project status regularly to senior stakeholders and a steering committee (SteerCo).",
    },
    { text: "Delivered end-to-end IT transformation programs from planning through completion." },
    { text: "Coordinated business and technical stakeholders across all project phases." },
    {
      text: "Identified, analyzed, and mitigated project risks; maintained a RAID risk register.",
    },
    {
      text: "Drove digital transformation initiatives with governance and benefit realisation.",
    },
    {
      text: "Held the title of Delivery Manager and a PMP project management certification.",
    },
    {
      text: "Managed Agile and Scrum delivery using JIRA, Confluence, and Microsoft Project.",
    },
    {
      text: "Executive-level communication with the C-suite; managed budget uplift and business case refresh.",
    },
  ],
  average: [
    { text: "Managed project timelines and deliverables for internal software projects." },
    { text: "Coordinated with cross-functional teams to gather requirements." },
    { text: "Provided regular status updates to my manager and stakeholders." },
    { text: "Used Asana and Trello to track project progress." },
    { text: "Worked in an Agile methodology on a delivery team." },
  ],
  weak: [
    { text: "Coordinated office events and scheduled team meetings." },
    { text: "Answered customer emails and maintained spreadsheets." },
    { text: "Assisted with data entry and document filing." },
    { text: "Enjoys hiking and photography on weekends." },
  ],
};
