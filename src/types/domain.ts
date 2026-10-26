export const ROLES = [
  "org_admin",
  "recruiter",
  "hiring_manager",
  "interviewer",
  "finance_approver",
] as const;

export type Role = (typeof ROLES)[number];

export const SALARY_ROLES: Role[] = ["org_admin", "recruiter", "finance_approver", "hiring_manager"];

export const PIPELINE_STAGES = [
  "applied",
  "ai_reviewed",
  "recruiter_review",
  "shortlisted",
  "screening_call",
  "interview",
  "assessment",
  "final_interview",
  "offer_approval",
  "offer_sent",
  "offer_accepted",
  "joined",
  "on_hold",
  "rejected",
  "withdrew",
  "no_response",
  "duplicate",
  "future_opportunity",
  "offer_declined",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const DEFAULT_SCORING_WEIGHTS = {
  mandatory_skills: 0.3,
  relevant_experience: 0.25,
  role_industry: 0.15,
  preferred_skills: 0.1,
  education_certs: 0.1,
  project_relevance: 0.05,
  availability: 0.05,
} as const;
