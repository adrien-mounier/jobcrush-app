# Job Offer Intake Template

Normalize every incoming job offer into this structure before tailoring. Strip LinkedIn UI noise ("Easy Apply", "Save", "About the company", "À propos de l'offre d'emploi") and keep semantic content only. Store the YAML block as front matter at the top of the offer file, with the raw offer text below under the `## Raw Offer Text` heading.

```yaml
---
job_title: ""
company: ""
location: ""
remote_policy: ""              # on-site | hybrid | remote | unspecified
employment_type: ""            # permanent | contract | freelance | internship | unspecified
seniority: ""                  # junior | mid | senior | lead | unspecified
years_experience_required: ""  # e.g. "8+" or "3-5" or unspecified
salary: ""                     # raw text or unspecified
languages: []                  # e.g. ["English", "French"]
job_family: ""                 # primary framing per CLAUDE.md §2 and §10:
                               # IT Project Manager | Project Manager | IT Product Owner | Product Owner |
                               # IT Product Manager | Product Manager | Program Manager | Delivery Manager |
                               # Scrum Master | Technical Project Manager | Digital Project Manager |
                               # Digital Product Manager | Technical Product Owner | Technical Product Manager |
                               # ambiguous (note blend)
required_skills: []
preferred_skills: []
responsibilities: []
tools_stack: []                # e.g. ["Jira", "Confluence", "Azure DevOps"]
methodologies: []              # e.g. ["Scrum", "SAFe", "Kanban"]
domain_industry: ""            # e.g. "FinTech", "Healthcare IT", "SaaS B2B"
keywords: []                   # high-signal terms for ATS coverage
hiring_signals: []             # context clues about company/team state, e.g. "post-Series-B",
                               # "regulatory pressure", "newly created role", "growing team"
application_url: ""
date_captured: ""              # ISO 8601, e.g. 2026-05-03
source: ""                     # e.g. "LinkedIn"
notes: ""                      # use for: role family ambiguity, employment type flags,
                               # title-vs-JD mismatches, interview warnings, strategic framing notes
---
```

## Raw Offer Text

Paste the cleaned offer text here. Remove all LinkedIn UI chrome (buttons, prompts, legal boilerplate unrelated to the role). Keep: job description, responsibilities, requirements, qualifications, benefits if role-relevant.
