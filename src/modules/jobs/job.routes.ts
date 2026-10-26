import { Router } from "express";
import { z } from "zod";
import slugify from "slugify";
import { Types } from "mongoose";
import { Job } from "./job.model.js";
import { Organization } from "../organizations/organization.model.js";
import { Candidate } from "../candidates/candidate.model.js";
import { Application } from "../applications/application.model.js";
import { Resume } from "../resumes/resume.model.js";
import { requireAuth, roleGuard, validate, type AuthedRequest } from "../../middleware/index.js";
import { ok, AppError, assertFound, assertTenant } from "../../utils/http.js";
import { computeFitScore, heuristicParseResume } from "../../services/scoring.service.js";
import { writeAudit } from "../../services/audit.service.js";
import { createPresignedDownload, createPresignedUpload } from "../../services/storage.service.js";
import { FileObject } from "../files/file.model.js";
import { notifyApplicationWebhook } from "../../services/application-webhook.service.js";
import {
  createNoirlyResponseText,
  generateJson,
  NOIRLY_MODELS,
  type NoirlyModel,
} from "../../services/noirly.service.js";

const router = Router();

const DEPARTMENTS = [
  "Development",
  "Design",
  "Marketing",
  "Customer Service",
  "Operations",
  "Finance",
  "Human Resources",
  "Sales",
  "Product",
  "Management",
] as const;

const aiCreateBody = z.object({
  brief: z.string().min(20, "Brief must be at least 20 characters"),
  vacancies: z.number().int().positive(),
  minExperience: z.number().min(0),
  maxExperience: z.number().min(0),
  location: z.string().min(1),
  workplaceType: z.enum(["onsite", "hybrid", "remote"]),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]),
  country: z.string().optional(),
  currency: z.string().optional(),
  model: z.enum(NOIRLY_MODELS).optional(),
});

const aiJobSchema = z.object({
  title: z.string().min(2),
  department: z.string().min(1),
  description: z.string().min(20),
  responsibilities: z.string().optional().default(""),
  benefits: z.string().optional().default(""),
  requirements: z
    .array(
      z.object({
        text: z.string().min(1),
        kind: z.enum(["mandatory", "preferred", "optional", "disqualifying"]),
        skill: z.string().optional(),
      }),
    )
    .default([]),
  screeningQuestions: z.array(z.string()).default([]),
  minSalary: z.number().nullable().optional().default(null),
  maxSalary: z.number().nullable().optional().default(null),
});

function clampDepartment(raw: string): string {
  const needle = raw.trim().toLowerCase();
  const hit = DEPARTMENTS.find((d) => d.toLowerCase() === needle);
  if (hit) return hit;
  const partial = DEPARTMENTS.find(
    (d) => needle.includes(d.toLowerCase()) || d.toLowerCase().includes(needle),
  );
  return partial ?? "Operations";
}

const requirementSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["mandatory", "preferred", "optional", "disqualifying"]),
  skill: z.string().optional(),
});

const jobBody = z.object({
  title: z.string().min(2),
  department: z.string().optional(),
  departmentId: z.string().optional(),
  hiringManagerId: z.string().optional(),
  recruiterId: z.string().optional(),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).optional(),
  workplaceType: z.enum(["onsite", "hybrid", "remote"]).optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  vacancies: z.number().int().positive().optional(),
  minExperience: z.number().optional(),
  maxExperience: z.number().optional(),
  minSalary: z.number().nullable().optional(),
  maxSalary: z.number().nullable().optional(),
  currency: z.string().optional(),
  applicationDeadline: z.union([z.string(), z.null()]).optional(),
  description: z.string().optional(),
  responsibilities: z.string().optional(),
  benefits: z.string().optional(),
  requirements: z.array(requirementSchema).optional(),
  screeningQuestions: z.array(z.string()).optional(),
  companyLogoHint: z.string().optional(),
  status: z.enum(["draft", "open", "paused", "closed", "filled", "archived"]).optional(),
});

router.get("/jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const filter = { organizationId: req.user!.organizationId, isDeleted: false };
    const [jobs, total] = await Promise.all([
      Job.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Job.countDocuments(filter),
    ]);
    ok(res, { jobs, page, limit, total });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/jobs",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(jobBody),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = { ...(req.body as z.infer<typeof jobBody>) };
      let slug = slugify(body.title, { lower: true, strict: true });
      const exists = await Job.findOne({
        organizationId: req.user!.organizationId,
        slug,
      });
      if (exists) slug = `${slug}-${Date.now().toString(36)}`;
      const deadline =
        body.applicationDeadline === undefined ||
        body.applicationDeadline === null ||
        body.applicationDeadline === ""
          ? null
          : new Date(body.applicationDeadline);
      const job = await Job.create({
        ...body,
        applicationDeadline: deadline,
        slug,
        organizationId: req.user!.organizationId,
        recruiterId: body.recruiterId ?? req.user!.sub,
      });
      ok(res, { job }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/jobs/ai-create",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(aiCreateBody),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof aiCreateBody>;
      if (body.maxExperience < body.minExperience) {
        throw new AppError(400, "VALIDATION_ERROR", "maxExperience must be >= minExperience");
      }

      const org = assertFound(
        await Organization.findById(req.user!.organizationId).lean(),
      );

      const model = (body.model ?? undefined) as NoirlyModel | undefined;
      const generated = await generateJson({
        model,
        system: [
          "You are HireFlow's recruiting assistant.",
          "Draft a complete job vacancy from a short hiring brief.",
          "Write clear, professional copy suitable for a public careers page.",
          `Pick department from this exact list: ${DEPARTMENTS.join(", ")}.`,
          "requirements[].kind must be mandatory or preferred (prefer those two).",
          "Include 4-8 mandatory/preferred requirements and 2-4 screening questions.",
          "Salary hints are optional numbers in the org currency; use null when unsure.",
        ].join(" "),
        user: JSON.stringify({
          organization: {
            name: org.name,
            industry: org.industry ?? null,
            country: org.country ?? null,
          },
          brief: body.brief,
          openings: body.vacancies,
          minExperience: body.minExperience,
          maxExperience: body.maxExperience,
          location: body.location,
          workplaceType: body.workplaceType,
          employmentType: body.employmentType,
          currency: body.currency || org.currency || "INR",
          expectedJsonShape: {
            title: "string",
            department: "one of the allowed departments",
            description: "string (role overview, 2-4 paragraphs)",
            responsibilities: "string (bullet-style lines separated by newlines)",
            benefits: "string (bullet-style lines separated by newlines)",
            requirements: [{ text: "string", kind: "mandatory|preferred", skill: "optional keyword" }],
            screeningQuestions: ["string"],
            minSalary: "number|null",
            maxSalary: "number|null",
          },
        }),
        schema: aiJobSchema,
      });

      const title = generated.title.trim();
      let slug = slugify(title, { lower: true, strict: true }) || "role";
      const exists = await Job.findOne({
        organizationId: req.user!.organizationId,
        slug,
      });
      if (exists) slug = `${slug}-${Date.now().toString(36)}`;

      const job = await Job.create({
        title,
        slug,
        department: clampDepartment(generated.department),
        employmentType: body.employmentType,
        workplaceType: body.workplaceType,
        location: body.location,
        country: body.country || org.country || "IN",
        vacancies: body.vacancies,
        minExperience: body.minExperience,
        maxExperience: body.maxExperience,
        minSalary: generated.minSalary ?? null,
        maxSalary: generated.maxSalary ?? null,
        currency: body.currency || org.currency || "INR",
        applicationDeadline: null,
        description: generated.description,
        responsibilities: generated.responsibilities || "",
        benefits: generated.benefits || "",
        requirements: generated.requirements.map((r) => ({
          text: r.text,
          kind: r.kind,
          skill: r.skill || r.text.split(/\s+/)[0]?.toLowerCase() || undefined,
        })),
        screeningQuestions: generated.screeningQuestions.filter((q) => q.trim().length >= 3),
        status: "draft",
        organizationId: req.user!.organizationId,
        recruiterId: req.user!.sub,
      });

      await writeAudit({
        organizationId: job.organizationId,
        actorId: req.user!.sub,
        action: "job.ai_create",
        entityType: "job",
        entityId: String(job._id),
        meta: { model: model ?? "default", title: job.title },
        ip: req.ip,
      });

      ok(res, { job }, 201);
    } catch (err) {
      next(err);
    }
  },
);

const aiRefineBody = z.object({
  fieldLabel: z.string().min(1).max(80),
  currentText: z.string().max(8000),
  instruction: z.string().min(1, "Tell the AI what to change").max(2000),
  model: z.enum(NOIRLY_MODELS).optional(),
});

router.post(
  "/jobs/ai-refine-field",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(aiRefineBody),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof aiRefineBody>;
      const model = (body.model ?? undefined) as NoirlyModel | undefined;

      const text = await createNoirlyResponseText({
        model,
        system: [
          "You are HireFlow's recruiting copy editor.",
          `You are editing the "${body.fieldLabel}" section of a job vacancy.`,
          "Apply the user's requested change to the current text and return ONLY the revised section text.",
          "Preserve the existing structure (paragraphs or one-item-per-line lists) unless the user asks otherwise.",
          "Do not add headings, labels, quotes, or commentary. Do not wrap the output in markdown fences.",
          "If the current text is empty, write the section from scratch based on the instruction.",
        ].join(" "),
        input: JSON.stringify({
          section: body.fieldLabel,
          instruction: body.instruction,
          currentText: body.currentText,
        }),
      });

      const revised = text
        .trim()
        .replace(/^```[a-z]*\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      await writeAudit({
        organizationId: req.user!.organizationId,
        actorId: req.user!.sub,
        action: "job.ai_refine_field",
        entityType: "job",
        entityId: "draft",
        meta: { model: model ?? "default", field: body.fieldLabel },
        ip: req.ip,
      });

      ok(res, { text: revised });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/jobs/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const job = assertFound(
      await Job.findOne({ _id: req.params.id, isDeleted: false }),
    );
    assertTenant(job.organizationId, req.user!.organizationId);
    ok(res, { job });
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/jobs/:id",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(jobBody.partial()),
  async (req: AuthedRequest, res, next) => {
    try {
      const job = assertFound(
        await Job.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(job.organizationId, req.user!.organizationId);
      const body = { ...(req.body as z.infer<typeof jobBody>) };
      if ("applicationDeadline" in body) {
        const raw = body.applicationDeadline;
        (body as { applicationDeadline?: Date | null }).applicationDeadline =
          raw === undefined || raw === null || raw === "" ? null : new Date(String(raw));
      }
      Object.assign(job, body);
      await job.save();
      ok(res, { job });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/jobs/:id/publish",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  async (req: AuthedRequest, res, next) => {
    try {
      const job = assertFound(
        await Job.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(job.organizationId, req.user!.organizationId);
      job.status = "open";
      await job.save();
      await writeAudit({
        organizationId: job.organizationId,
        actorId: req.user!.sub,
        action: "job.publish",
        entityType: "job",
        entityId: String(job._id),
        ip: req.ip,
      });
      ok(res, { job });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/jobs/:id/draft-jd",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  async (req: AuthedRequest, res, next) => {
    try {
      const job = assertFound(
        await Job.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(job.organizationId, req.user!.organizationId);
      const skills = job.requirements.map((r) => r.skill || r.text).filter(Boolean);
      const draft = [
        `About the role`,
        `We are hiring a ${job.title} (${job.employmentType.replace("_", " ")}) based in ${job.location || "our office"} (${job.workplaceType}).`,
        ``,
        `Responsibilities`,
        `- Own delivery for ${job.title} initiatives`,
        `- Collaborate with cross-functional partners`,
        `- Raise the quality bar for the team`,
        ``,
        `Requirements`,
        ...skills.map((s) => `- ${s}`),
        ``,
        `Experience: ${job.minExperience}-${job.maxExperience} years`,
        ``,
        `[AI-generated draft — edit before publishing]`,
      ].join("\n");
      ok(res, { draft, label: "AI-generated job description" });
    } catch (err) {
      next(err);
    }
  },
);

// Public job + apply
async function publicOrgPayload(org: {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  industry?: string;
  website?: string;
  country?: string;
  careersAccentColor?: string | null;
  logoFileId?: Types.ObjectId | null;
}) {
  let logoUrl: string | null = null;
  if (org.logoFileId) {
    try {
      logoUrl = await createPresignedDownload(org.logoFileId, String(org._id));
    } catch {
      logoUrl = null;
    }
  }
  return {
    name: org.name,
    slug: org.slug,
    industry: org.industry,
    website: org.website,
    country: org.country,
    careersAccentColor: org.careersAccentColor || "#171717",
    logoUrl,
  };
}

router.get("/public/careers/:orgSlug", async (req, res, next) => {
  try {
    const org = assertFound(
      await Organization.findOne({ slug: req.params.orgSlug, isDeleted: false }),
    );
    const jobs = await Job.find({
      organizationId: org._id,
      status: "open",
      isDeleted: false,
    })
      .sort({ updatedAt: -1 })
      .select(
        "title slug department location employmentType workplaceType description vacancies filledCount",
      );

    ok(res, {
      organization: await publicOrgPayload(org),
      jobs: jobs.map((job) => ({
        id: job._id,
        title: job.title,
        slug: job.slug,
        department: job.department,
        location: job.location,
        employmentType: job.employmentType,
        workplaceType: job.workplaceType,
        description: job.description,
        vacancies: job.vacancies,
        filledCount: job.filledCount,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/public/jobs/:orgSlug/:jobSlug", async (req, res, next) => {
  try {
    const org = assertFound(
      await Organization.findOne({ slug: req.params.orgSlug, isDeleted: false }),
    );
    const job = assertFound(
      await Job.findOne({
        organizationId: org._id,
        slug: req.params.jobSlug,
        status: "open",
        isDeleted: false,
      }),
    );
    ok(res, {
      organization: await publicOrgPayload(org),
      job: {
        id: job._id,
        title: job.title,
        slug: job.slug,
        department: job.department,
        description: job.description,
        responsibilities: job.responsibilities,
        location: job.location,
        employmentType: job.employmentType,
        workplaceType: job.workplaceType,
        minExperience: job.minExperience,
        maxExperience: job.maxExperience,
        screeningQuestions: job.screeningQuestions,
      },
      privacyNotice:
        "By applying you consent to HireFlow processing your personal data for recruitment purposes. Data retention follows the hiring organization's policy.",
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/public/jobs/:orgSlug/:jobSlug/resume/presign",
  validate(
    z.object({
      mime: z.string().min(3),
      size: z.number().int().positive(),
    }),
  ),
  async (req, res, next) => {
    try {
      const org = assertFound(
        await Organization.findOne({ slug: req.params.orgSlug, isDeleted: false }),
      );
      assertFound(
        await Job.findOne({
          organizationId: org._id,
          slug: req.params.jobSlug,
          status: "open",
          isDeleted: false,
        }),
      );
      const body = req.body as { mime: string; size: number };
      const result = await createPresignedUpload({
        organizationId: String(org._id),
        purpose: "resume",
        mime: body.mime,
        size: body.size,
        candidateId: "public-apply",
      });
      ok(res, result, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/public/jobs/:orgSlug/:jobSlug/resume/confirm",
  validate(z.object({ fileId: z.string() })),
  async (req, res, next) => {
    try {
      const org = assertFound(
        await Organization.findOne({ slug: req.params.orgSlug, isDeleted: false }),
      );
      assertFound(
        await Job.findOne({
          organizationId: org._id,
          slug: req.params.jobSlug,
          status: "open",
          isDeleted: false,
        }),
      );
      const file = assertFound(
        await FileObject.findOne({
          _id: req.body.fileId,
          organizationId: org._id,
          purpose: "resume",
          isDeleted: false,
        }),
      );
      ok(res, { fileId: file._id, mime: file.mime, size: file.size });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/public/jobs/:orgSlug/:jobSlug/apply",
  validate(
    z
      .object({
        fullName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional(),
        resumeText: z.string().optional(),
        resumeFileId: z.string().optional(),
        screeningAnswers: z.array(z.string()).optional(),
        consent: z.literal(true),
      })
      .refine((v) => Boolean(v.resumeFileId) || Boolean(v.resumeText?.trim()), {
        message: "Upload a resume or add an experience summary",
        path: ["resumeFileId"],
      }),
  ),
  async (req, res, next) => {
    try {
      const org = assertFound(
        await Organization.findOne({ slug: req.params.orgSlug, isDeleted: false }),
      );
      const job = assertFound(
        await Job.findOne({
          organizationId: org._id,
          slug: req.params.jobSlug,
          status: "open",
          isDeleted: false,
        }),
      );
      const body = req.body as {
        fullName: string;
        email: string;
        phone?: string;
        resumeText?: string;
        resumeFileId?: string;
        screeningAnswers?: string[];
      };

      if (body.resumeFileId) {
        assertFound(
          await FileObject.findOne({
            _id: body.resumeFileId,
            organizationId: org._id,
            purpose: "resume",
            isDeleted: false,
          }),
        );
      }

      const questions = job.screeningQuestions ?? [];
      if (questions.length > 0) {
        const answers = body.screeningAnswers ?? [];
        if (answers.length !== questions.length || answers.some((a) => !a?.trim())) {
          throw new AppError(400, "VALIDATION_ERROR", "Please answer every screening question");
        }
      }

      let candidate = await Candidate.findOne({
        organizationId: org._id,
        email: body.email.toLowerCase(),
        isDeleted: false,
      });

      const parsed = heuristicParseResume(body.resumeText ?? "", body.fullName);
      if (!candidate) {
        candidate = await Candidate.create({
          organizationId: org._id,
          fullName: body.fullName,
          email: body.email.toLowerCase(),
          phone: body.phone ?? parsed.phone,
          skills: parsed.skills,
          about: parsed.about,
          // Role / location come from the vacancy the candidate applied to
          currentDesignation: job.title,
          currentCity: job.location || "",
          country: job.country || "",
          source: "public_apply",
        });
      } else {
        let dirty = false;
        if (body.phone) {
          candidate.phone = body.phone;
          dirty = true;
        }
        // Fill blanks from this vacancy so list columns are not empty for public apply
        if (!candidate.currentDesignation && job.title) {
          candidate.currentDesignation = job.title;
          dirty = true;
        }
        if (!candidate.currentCity && job.location) {
          candidate.currentCity = job.location;
          dirty = true;
        }
        if (!candidate.country && job.country) {
          candidate.country = job.country;
          dirty = true;
        }
        if (dirty) await candidate.save();
      }

      if (body.resumeFileId) {
        await Resume.create({
          organizationId: org._id,
          candidateId: candidate._id,
          fileId: body.resumeFileId,
          rawText: body.resumeText ?? "",
          parsedJson: parsed,
          confidence: parsed.confidence,
          parseStatus: "done",
        });
      }

      let application = await Application.findOne({
        organizationId: org._id,
        jobId: job._id,
        candidateId: candidate._id,
      });
      if (!application) {
        const explanation = computeFitScore({
          skills: candidate.skills,
          totalExperience: candidate.totalExperience,
          relevantExperience: candidate.relevantExperience,
          noticePeriodDays: candidate.noticePeriodDays ?? null,
          currentDesignation: candidate.currentDesignation,
          workHistory: candidate.workHistory.map((w) => ({
            company: w.company ?? undefined,
            title: w.title ?? undefined,
            description: w.description ?? undefined,
          })),
          education: candidate.education.map((e) => ({
            degree: e.degree ?? undefined,
            field: e.field ?? undefined,
          })),
          certifications: candidate.certifications,
          projects: candidate.projects,
          job: {
            minExperience: job.minExperience,
            maxExperience: job.maxExperience,
            title: job.title,
            requirements: job.requirements.map((r) => ({
              text: r.text,
              kind: r.kind,
              skill: r.skill,
            })),
          },
          weights: org.scoringWeights as Record<string, number>,
        });
        application = await Application.create({
          organizationId: org._id,
          jobId: job._id,
          candidateId: candidate._id,
          source: "public_apply",
          stage: "ai_reviewed",
          fitScore: explanation.score,
          fitExplanation: explanation,
          eligibility: explanation.eligibility,
          screeningAnswers: body.screeningAnswers ?? [],
        });
      }

      const screeningQuestions = job.screeningQuestions ?? [];
      const screeningAnswers = body.screeningAnswers ?? [];
      notifyApplicationWebhook({
        event: "application.created",
        organizationName: org.name,
        organizationSlug: org.slug,
        role: job.title,
        location: job.location || "",
        city: job.location || "",
        country: job.country || "",
        department: job.department || "",
        workplaceType: job.workplaceType || "",
        employmentType: job.employmentType || "",
        jobSlug: job.slug,
        fullName: body.fullName,
        email: body.email.toLowerCase(),
        phone: body.phone ?? candidate.phone ?? "",
        resumeText: body.resumeText?.trim() ?? "",
        screeningQuestions,
        screeningAnswers,
        screening: screeningQuestions.map((question, i) => ({
          question,
          answer: screeningAnswers[i] ?? "",
        })),
        applicationId: String(application._id),
        candidateId: String(candidate._id),
        jobId: String(job._id),
        source: application.source || "public_apply",
        submittedAt: new Date().toISOString(),
      });

      ok(res, { applicationId: application._id, candidateId: candidate._id }, 201);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
