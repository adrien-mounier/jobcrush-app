import type { AdRequirement, AdRequirements } from "@jobcrush/contracts";
import type { ScoredFact } from "../../src/matchtick.js";

type Requirement = Omit<AdRequirement, "id">;

const ad = (adId: string, requirements: Requirement[]): AdRequirements => ({
  schemaVersion: "0",
  adId,
  curated: false,
  requirements: requirements.map((requirement, index) => ({
    id: `${adId}-${index}`,
    ...requirement,
  })),
});

// Exact 17 hand-derived requirement arrays from #14's recovered throwaway harness. Together with
// the three original repo fixtures below, these reproduce docs/card-quality-taste-test.md's 20 ads.
export const DERIVED_TASTE_TEST_ADS: AdRequirements[] = [
  ad("schneider-electric", [
    { band: "must", requirement: "Lead end-to-end execution of customer projects" },
    { band: "must", requirement: "Manage budgets, timelines, and cross-functional teams" },
    { band: "must", requirement: "Conduct risk assessments and mitigation strategies" },
    {
      band: "should",
      requirement:
        "Foster customer relationships through clear communication and stakeholder engagement",
    },
    {
      band: "should",
      requirement: "Ensure adherence to quality standards and compliance requirements",
    },
    { band: "nice", requirement: "Drive operational efficiency and cost reduction" },
  ]),
  ad("hays", [
    { band: "must", requirement: "Front office project management and business analysis duties" },
    { band: "must", requirement: "Lead gathering and documenting business requirements" },
    {
      band: "must",
      requirement: "Oversee communication and governance among diverse stakeholder groups",
    },
    { band: "should", requirement: "8+ years operations BA/PM experience at a top bank" },
    { band: "nice", requirement: "AI and automation projects exposure" },
    { band: "nice", requirement: "Knowledge of financial products" },
  ]),
  ad("transunion", [
    {
      band: "must",
      requirement: "Manage multiple concurrent projects end-to-end from initiation through delivery",
    },
    {
      band: "must",
      requirement: "Define project scope, priorities, deliverables, dependencies, and target dates",
    },
    { band: "must", requirement: "Identify, track, and mitigate project risks and issues" },
    {
      band: "should",
      requirement: "Manage vendor onboarding, relationships, contracts, and performance",
    },
    { band: "should", requirement: "Oversee CapEx and OpEx financial management" },
    {
      band: "should",
      requirement: "Use project management tools including Jira, Confluence, SharePoint",
    },
    { band: "nice", requirement: "Define and manage Agile epics, user stories, and sprints" },
  ]),
  ad("computershare", [
    { band: "must", requirement: "Lead end-to-end business readiness for a mobile app launch" },
    {
      band: "must",
      requirement:
        "Ensure business prepared across regulatory, legal, operational and client-facing environments",
    },
    {
      band: "must",
      requirement: "Drive readiness planning, governance, documentation, reporting and decision-making",
    },
    {
      band: "should",
      requirement: "Partner with stakeholders across Product, Technology, Legal, Operations",
    },
    { band: "nice", requirement: "Local regulatory execution such as ICP and app registration" },
  ]),
  ad("hire-feed", [
    {
      band: "must",
      requirement: "Manage assigned projects from initiation to completion within scope, budget, and timelines",
    },
    {
      band: "must",
      requirement: "Coordinate with internal teams and external stakeholders to gather requirements",
    },
    {
      band: "should",
      requirement: "Monitor project progress through updates, risk assessments, and mitigation",
    },
    {
      band: "should",
      requirement: "Prepare and present detailed project reports to clients and senior management",
    },
    {
      band: "nice",
      requirement: "Proficiency in project management tools such as Asana, Trello, or Jira",
    },
  ]),
  ad("okx", [
    { band: "must", requirement: "Drive high-impact cross-functional strategic initiatives" },
    {
      band: "must",
      requirement: "Structure complex business problems and leverage data and AI-assisted workflows",
    },
    {
      band: "should",
      requirement: "Partner with senior leadership to translate strategies into execution",
    },
    {
      band: "should",
      requirement: "Support operational scaling and organizational effectiveness through automation",
    },
    {
      band: "nice",
      requirement: "Background from technology, consulting, fintech, or platform environments",
    },
  ]),
  ad("synpulse", [
    {
      band: "must",
      requirement: "Lead and manage full project lifecycles for data warehouse and migration initiatives",
    },
    {
      band: "must",
      requirement: "Coordinate with internal stakeholders, technology teams, and external vendors",
    },
    {
      band: "must",
      requirement: "Monitor project risks, issues, and dependencies with timely resolution",
    },
    {
      band: "should",
      requirement: "Drive governance, documentation, and reporting to steering committees",
    },
    { band: "should", requirement: "Led end-to-end large scale transformation projects" },
    { band: "nice", requirement: "Strong background in Wealth Management and Private Banking" },
  ]),
  ad("bnp-reg-reporting", [
    {
      band: "must",
      requirement:
        "Manage end-to-end regulatory reporting projects, milestones, dependencies, resource allocation",
    },
    { band: "must", requirement: "Drive regular, clear communication with all stakeholders" },
    {
      band: "must",
      requirement: "Apply IT project governance model, change control, and post implementation reviews",
    },
    {
      band: "should",
      requirement: "Ensure deliverables meet quality and standards preserving system stability",
    },
    {
      band: "should",
      requirement: "Gather and translate regulatory requirements into project plans and timelines",
    },
    { band: "nice", requirement: "Perform in-depth analysis to support business cases" },
  ]),
  ad("charterhouse", [
    { band: "must", requirement: "Own end-to-end requirements across the programme lifecycle" },
    {
      band: "must",
      requirement:
        "Lead and facilitate discovery workshops across business, operations, technology, compliance",
    },
    {
      band: "must",
      requirement:
        "Act as primary interface between business stakeholders, technology teams, and payments SMEs",
    },
    {
      band: "should",
      requirement:
        "Produce Business Requirements Documents, Functional Specifications, User Stories, Process Maps",
    },
    {
      band: "should",
      requirement: "Support UAT planning, execution, defect management, and validation",
    },
    { band: "nice", requirement: "8+ years as a Business Analyst or Product Manager" },
  ]),
  ad("mri-software", [
    {
      band: "must",
      requirement: "Define project scope, objectives, and deliverables in collaboration with stakeholders",
    },
    {
      band: "must",
      requirement: "Lead cross-functional teams to deliver projects on time and within budget",
    },
    {
      band: "must",
      requirement: "Identify potential risks early and develop mitigation strategies",
    },
    {
      band: "should",
      requirement: "Establish governance frameworks and ensure compliance with organizational standards",
    },
    {
      band: "should",
      requirement: "Communicate effectively with executives, clients, and internal teams",
    },
    { band: "nice", requirement: "Project Management certification such as PMP or PRINCE2" },
    { band: "nice", requirement: "Mentor junior project managers and team members" },
  ]),
  ad("pwc-australia", [
    {
      band: "must",
      requirement: "Lead end-to-end delivery across onboarding and risk assessment redesign",
    },
    {
      band: "must",
      requirement: "Lead multi-discipline programs partnering with stakeholders across internal functions",
    },
    {
      band: "must",
      requirement: "Translate complex risk and operational challenges into clear problem statements",
    },
    {
      band: "should",
      requirement: "Support development of business requirements, scope, and acceptance criteria",
    },
    {
      band: "should",
      requirement: "Lead operating model design for streamlined onboarding pathways",
    },
    {
      band: "nice",
      requirement: "Align global standards, regulatory obligations, and local business requirements",
    },
  ]),
  ad("sanderson-ikas", [
    {
      band: "must",
      requirement: "Lead requirements gathering, user story preparation, and workflow design",
    },
    {
      band: "must",
      requirement:
        "Drive deliverables end-to-end: feasibility, requirement analysis, documentation, UAT, implementation",
    },
    {
      band: "should",
      requirement: "Partner with UX designers on wireframes, prototypes, and design reviews",
    },
    {
      band: "should",
      requirement: "Experience in digital transformation across mobile and web",
    },
    { band: "nice", requirement: "Experience in Banking and Financial Services industry" },
  ]),
  ad("bnp-drive", [
    {
      band: "must",
      requirement: "Frame the project upfront and define governance to lead the project to success",
    },
    {
      band: "must",
      requirement: "Build and maintain the project plan, manage dependencies and critical path",
    },
    {
      band: "must",
      requirement:
        "Drive the project team to completion with effective communication and stakeholder alignment",
    },
    {
      band: "should",
      requirement:
        "Consolidate solution design with signoff from clients, IT architecture, and contributors",
    },
    {
      band: "should",
      requirement: "Secure staffing of the project team with support of line managers",
    },
    {
      band: "nice",
      requirement: "Perform project retrospective to leverage experience and learn lessons",
    },
  ]),
  ad("generic-pm", [
    { band: "must", requirement: "Deliver projects on time and within budget" },
    { band: "must", requirement: "Manage stakeholders and communication" },
    { band: "should", requirement: "Coordinate cross-functional teams" },
    { band: "nice", requirement: "Strong organizational skills" },
  ]),
  ad("cert-heavy-finance", [
    { band: "must", requirement: "Hold a PMP or PRINCE2 project management certification" },
    {
      band: "must",
      requirement: "Manage large-scale banking system implementation projects",
    },
    {
      band: "must",
      requirement: "Deliver executive-level SteerCo reporting to senior sponsors",
    },
    { band: "should", requirement: "Own project budget and financial management" },
    { band: "nice", requirement: "Degree in finance or business" },
  ]),
  ad("agile-tooling", [
    { band: "must", requirement: "Lead Agile and Scrum delivery with ceremonies and sprints" },
    { band: "must", requirement: "Use JIRA, Confluence, and Microsoft Project for tracking" },
    { band: "must", requirement: "Coordinate technical delivery teams and vendors" },
    { band: "should", requirement: "Manage release schedules and resource allocation" },
    { band: "nice", requirement: "Software development lifecycle understanding" },
  ]),
  ad("exec-comms", [
    { band: "must", requirement: "Deliver executive-level communication and SteerCo reporting" },
    {
      band: "must",
      requirement: "Own budget uplift and business case refresh for the program",
    },
    {
      band: "must",
      requirement: "Manage third-party vendors and system integrators against SOWs",
    },
    {
      band: "should",
      requirement: "Coordinate multiple workstreams, sequencing, and interdependencies",
    },
    { band: "nice", requirement: "Operate in complex, challenging stakeholder environment" },
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
