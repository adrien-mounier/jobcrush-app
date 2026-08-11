// A deliberately small, sanitised slice of a real Techmap response captured through the staging
// provider integration. The live capture returned ten jsonLD.description values; only the text
// needed to exercise sparse advert formats is retained here, with spelling, spacing, and formatting
// unchanged. baselineVerdict records the pre-#113 detector's measured result. These rows are a real-
// provider calibration/regression set; the separate measured sparse-format cases are the red/green
// evidence for the fallback added by #113.
export const TECHMAP_LANGUAGE_SAMPLES = {
  metadata: {
    provider: "techmap",
    capturedAt: "2026-08-11",
    region: "HK",
    query: "project manager",
    sourceField: "jsonLD.description",
  },
  adverts: [
    {
      title: "Sales Executive / Account Manager / Sales Manager - IT",
      baselineVerdict: "en",
      description:
        "**Solutions:**\n\n1. IT Total Solutions (Storage, Network, Cyber Security, Data), or\n\n" +
        "2. Cloud (AWS, Google Cloud, AliCloud, Bytedance), or\n\n" +
        "3. Co-location Services, or\n\n4. IoT, RFID Solutions, Smart solutions or\n\n" +
        "5. Software solution (ERP, DMS, CRM, Workflow system), or\n\n" +
        "6. Hybrid BPO Business (Data conversion, AI OCR, workflow management and automation)\n\n" +
        "7. ESG Software\n\nResponsibilities:\n\n" +
        "* Selling Solutions to FSI, PU, Government & Commercial clients\n\n" +
        "* Build and maintain close relationship with both existing and potential clients",
    },
    {
      title: "Assistant Manager, IT",
      baselineVerdict: "en",
      description:
        "Job Description\n- --------------\n\n**Responsibilities:**\n\n" +
        "* ConductsystemauditstoensurecompliancewithIToperationalstandards,collaboratewithsupportteamstoaddressissues, and report findings to Line Manager\n\n" +
        "* OptimizesystemremotemonitoringwithSOCCanddeliveryteams,prioritizecriticalalerts,anddevelopimprovedmonitoring solutions for better reliability.\n\n" +
        "* Facilitatecapacityplanning,ensuringthoroughreviewsandaccuratereportsbysupportteams,andprovideoversightand support for future growth.",
    },
    {
      title: "Senior Technical Program Manager, NPI Manufacturing, Pixel Watch",
      baselineVerdict: "en",
      description:
        "Job Description\n- --------------\n\nGoogle welcomes people with disabilities.\n\n" +
        "**Minimum qualifications:**\n\n* Bachelor's degree in a technical field, or equivalent " +
        "practical experience.\n* 5 years of experience in program management.\n" +
        "* 5 years of relevant process, research, or product development experience involving " +
        "electro-mechanical products.\n* Experience with manufacturing process or fixture " +
        "development and validation experience.",
    },
  ],
} as const;
