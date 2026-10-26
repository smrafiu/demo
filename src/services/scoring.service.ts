import { DEFAULT_SCORING_WEIGHTS } from "../types/domain.js";

export type Requirement = {
  text: string;
  kind: "mandatory" | "preferred" | "optional" | "disqualifying";
  skill?: string;
};

export type ScoreInput = {
  skills: string[];
  totalExperience: number;
  relevantExperience: number;
  noticePeriodDays: number | null;
  currentDesignation: string;
  workHistory: { company?: string; title?: string; description?: string }[];
  education: { degree?: string; field?: string }[];
  certifications: string[];
  projects: string[];
  job: {
    minExperience: number;
    maxExperience: number;
    title: string;
    requirements: Requirement[];
  };
  weights?: Record<string, number>;
};

export type FitExplanation = {
  score: number;
  eligibility: "passed" | "failed" | "unavailable" | "human_review";
  breakdown: { factor: string; weight: number; points: number; detail: string }[];
  strengths: string[];
  gaps: string[];
  missingInformation: string[];
  modelMeta: { scoringVersion: string; explainedBy: string };
};

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function skillMatch(candidateSkills: string[], needle: string): boolean {
  const n = norm(needle);
  return candidateSkills.some((s) => {
    const cs = norm(s);
    return cs === n || cs.includes(n) || n.includes(cs);
  });
}

export function computeFitScore(input: ScoreInput): FitExplanation {
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...(input.weights ?? {}) };
  const skills = input.skills.map(norm);
  const mandatory = input.job.requirements.filter((r) => r.kind === "mandatory");
  const preferred = input.job.requirements.filter((r) => r.kind === "preferred");
  const disqualifying = input.job.requirements.filter((r) => r.kind === "disqualifying");

  const strengths: string[] = [];
  const gaps: string[] = [];
  const missingInformation: string[] = [];

  let mandatoryHits = 0;
  for (const req of mandatory) {
    const token = req.skill || req.text;
    if (skillMatch(skills, token) || norm(input.currentDesignation).includes(norm(token))) {
      mandatoryHits += 1;
      strengths.push(`Matches mandatory: ${req.text}`);
    } else {
      gaps.push(`Missing mandatory: ${req.text}`);
    }
  }

  let disqualified = false;
  for (const req of disqualifying) {
    const token = req.skill || req.text;
    if (skillMatch(skills, token)) {
      disqualified = true;
      gaps.push(`Disqualifying factor present: ${req.text}`);
    }
  }

  const mandatoryRatio = mandatory.length ? mandatoryHits / mandatory.length : 1;
  const preferredHits = preferred.filter((r) => skillMatch(skills, r.skill || r.text)).length;
  const preferredRatio = preferred.length ? preferredHits / preferred.length : 0.5;

  const exp = input.relevantExperience || input.totalExperience;
  let expScore = 0.5;
  if (exp >= input.job.minExperience && exp <= input.job.maxExperience + 2) {
    expScore = 1;
    strengths.push(`Has ${exp} years relevant experience`);
  } else if (exp < input.job.minExperience) {
    expScore = Math.max(0, exp / Math.max(input.job.minExperience, 1));
    gaps.push(`Experience below minimum (${input.job.minExperience}+ years)`);
  } else {
    expScore = 0.85;
  }

  const titleTokens = norm(input.job.title).split(/\s+/);
  const roleBlob = [
    input.currentDesignation,
    ...input.workHistory.map((w) => `${w.title ?? ""} ${w.description ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();
  const roleHits = titleTokens.filter((t) => t.length > 2 && roleBlob.includes(t)).length;
  const roleScore = titleTokens.length ? roleHits / titleTokens.length : 0.5;

  const eduScore =
    input.education.length || input.certifications.length
      ? Math.min(1, (input.education.length + input.certifications.length) / 3)
      : 0.4;
  if (!input.education.length) missingInformation.push("Education details not provided");

  const projectScore = input.projects.length
    ? Math.min(1, input.projects.length / 2)
    : input.workHistory.length
      ? 0.6
      : 0.3;

  let availability = 0.7;
  if (input.noticePeriodDays == null) {
    missingInformation.push("Notice period not provided");
    availability = 0.5;
  } else if (input.noticePeriodDays <= 30) {
    availability = 1;
    strengths.push(`Available within ${input.noticePeriodDays} days`);
  } else if (input.noticePeriodDays <= 60) {
    availability = 0.75;
  } else {
    availability = 0.4;
    gaps.push("Long notice period");
  }

  const factors: { factor: string; weight: number; ratio: number; detail: string }[] = [
    {
      factor: "mandatory_skills",
      weight: weights.mandatory_skills,
      ratio: mandatoryRatio,
      detail: `${mandatoryHits}/${mandatory.length || 0} mandatory requirements matched`,
    },
    {
      factor: "relevant_experience",
      weight: weights.relevant_experience,
      ratio: expScore,
      detail: `${exp} years vs ${input.job.minExperience}-${input.job.maxExperience} required`,
    },
    {
      factor: "role_industry",
      weight: weights.role_industry,
      ratio: roleScore,
      detail: "Title and history similarity to job role",
    },
    {
      factor: "preferred_skills",
      weight: weights.preferred_skills,
      ratio: preferredRatio,
      detail: `${preferredHits}/${preferred.length || 0} preferred skills matched`,
    },
    {
      factor: "education_certs",
      weight: weights.education_certs,
      ratio: eduScore,
      detail: "Education and certifications completeness",
    },
    {
      factor: "project_relevance",
      weight: weights.project_relevance,
      ratio: projectScore,
      detail: "Projects and work history signal",
    },
    {
      factor: "availability",
      weight: weights.availability,
      ratio: availability,
      detail: "Notice period / availability fit",
    },
  ];

  let score = Math.round(
    factors.reduce((sum, f) => sum + f.weight * f.ratio * 100, 0),
  );
  if (disqualified) score = Math.min(score, 35);

  let eligibility: FitExplanation["eligibility"] = "passed";
  if (disqualified || mandatoryRatio < 1) eligibility = "failed";
  if (mandatory.length === 0 && skills.length === 0) eligibility = "unavailable";
  if (mandatoryRatio < 1 && mandatoryHits > 0) eligibility = "human_review";

  return {
    score: Math.max(0, Math.min(100, score)),
    eligibility,
    breakdown: factors.map((f) => ({
      factor: f.factor,
      weight: f.weight,
      points: Math.round(f.weight * f.ratio * 100),
      detail: f.detail,
    })),
    strengths,
    gaps,
    missingInformation,
    modelMeta: { scoringVersion: "1", explainedBy: "rules" },
  };
}

/** Lightweight resume "parse" for MVP when no AI key / binary extractors. */
export function heuristicParseResume(text: string, fallbackName = "Candidate") {
  const email =
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? "";
  const phone = text.match(/(?:\+?\d[\d\s\-()]{8,}\d)/)?.[0]?.trim() ?? "";
  const skillHints = [
    "react",
    "node",
    "typescript",
    "javascript",
    "python",
    "java",
    "aws",
    "mongodb",
    "sql",
    "figma",
    "product",
    "sales",
    "marketing",
  ];
  const lower = text.toLowerCase();
  const skills = skillHints.filter((s) => lower.includes(s));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = lines[0] && lines[0].length < 60 ? lines[0] : fallbackName;

  return {
    fullName: name,
    email,
    phone,
    skills,
    about: lines.slice(0, 5).join(" ").slice(0, 500),
    workHistory: [] as { company?: string; title?: string; location?: string }[],
    education: [] as { school?: string; degree?: string }[],
    certifications: [] as string[],
    projects: [] as string[],
    confidence: {
      fullName: name ? "medium" : "low",
      email: email ? "high" : "not_detected",
      phone: phone ? "medium" : "not_detected",
      skills: skills.length ? "medium" : "low",
    },
  };
}
