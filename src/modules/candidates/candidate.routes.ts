import { Router } from "express";
import { z } from "zod";
import { Candidate } from "./candidate.model.js";
import { Application } from "../applications/application.model.js";
import { Resume } from "../resumes/resume.model.js";
import { Job } from "../jobs/job.model.js";
import { Organization } from "../organizations/organization.model.js";
import { PipelineEvent } from "../auditLogs/audit.model.js";
import { requireAuth, roleGuard, validate, type AuthedRequest } from "../../middleware/index.js";
import { ok, assertFound, assertTenant, AppError } from "../../utils/http.js";
import { PIPELINE_STAGES, SALARY_ROLES } from "../../types/domain.js";
import { computeFitScore, heuristicParseResume } from "../../services/scoring.service.js";
import { writeAudit } from "../../services/audit.service.js";
import { createPresignedDownload } from "../../services/storage.service.js";
import { FileObject } from "../files/file.model.js";

const router = Router();

function stripSalary(candidate: Record<string, unknown>, role: string) {
  if (!SALARY_ROLES.includes(role as (typeof SALARY_ROLES)[number])) {
    delete candidate.currentSalary;
    delete candidate.expectedSalary;
  }
  return candidate;
}

router.get("/candidates", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const q = String(req.query.q ?? "");
    const filter: Record<string, unknown> = {
      organizationId: req.user!.organizationId,
      isDeleted: false,
    };
    if (q) filter.$text = { $search: q };
    const [candidates, total] = await Promise.all([
      Candidate.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Candidate.countDocuments(filter),
    ]);
    ok(res, {
      candidates: candidates.map((c) =>
        stripSalary({ ...c, id: c._id }, req.user!.role),
      ),
      page,
      limit,
      total,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/candidates",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(
    z.object({
      fullName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional(),
      currentCity: z.string().optional(),
      currentCompany: z.string().optional(),
      currentDesignation: z.string().optional(),
      skills: z.array(z.string()).optional(),
      totalExperience: z.number().optional(),
      noticePeriodDays: z.number().nullable().optional(),
      level: z.enum(["junior", "mid", "senior", "lead", "executive"]).optional(),
      about: z.string().optional(),
      source: z.enum(["manual", "resume_upload"]).optional(),
      jobId: z.string().optional(),
      resumeText: z.string().optional(),
      resumeFileId: z.string().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as {
        fullName: string;
        email: string;
        phone?: string;
        currentCity?: string;
        currentCompany?: string;
        currentDesignation?: string;
        skills?: string[];
        totalExperience?: number;
        noticePeriodDays?: number | null;
        level?: "junior" | "mid" | "senior" | "lead" | "executive";
        about?: string;
        source?: "manual" | "resume_upload";
        jobId?: string;
        resumeText?: string;
        resumeFileId?: string;
      };
      const parsed = body.resumeText
        ? heuristicParseResume(body.resumeText, body.fullName)
        : null;
      const candidate = await Candidate.create({
        organizationId: req.user!.organizationId,
        fullName: body.fullName,
        email: body.email.toLowerCase(),
        phone: body.phone ?? parsed?.phone ?? "",
        currentCity: body.currentCity ?? "",
        currentCompany: body.currentCompany ?? "",
        currentDesignation: body.currentDesignation ?? "",
        skills: body.skills ?? parsed?.skills ?? [],
        totalExperience: body.totalExperience ?? 0,
        noticePeriodDays: body.noticePeriodDays ?? null,
        level: body.level ?? "mid",
        about: body.about ?? parsed?.about ?? "",
        source: body.source ?? "manual",
        ownerUserId: req.user!.sub,
      });

      if (body.resumeFileId) {
        await Resume.create({
          organizationId: req.user!.organizationId,
          candidateId: candidate._id,
          fileId: body.resumeFileId,
          rawText: body.resumeText ?? "",
          parsedJson: parsed ?? {},
          confidence: parsed?.confidence ?? {},
          parseStatus: "done",
        });
      }

      let application = null;
      if (body.jobId) {
        const job = assertFound(
          await Job.findOne({
            _id: body.jobId,
            organizationId: req.user!.organizationId,
            isDeleted: false,
          }),
        );
        const org = assertFound(await Organization.findById(req.user!.organizationId));
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
          organizationId: req.user!.organizationId,
          jobId: job._id,
          candidateId: candidate._id,
          source: body.source ?? "manual",
          stage: "ai_reviewed",
          fitScore: explanation.score,
          fitExplanation: explanation,
          eligibility: explanation.eligibility,
        });
      }

      ok(res, { candidate, application }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/candidates/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const candidate = assertFound(
      await Candidate.findOne({ _id: req.params.id, isDeleted: false }).lean(),
    );
    assertTenant(candidate.organizationId, req.user!.organizationId);
    const applications = await Application.find({
      candidateId: candidate._id,
      isDeleted: false,
    }).populate("jobId", "title slug status");
    let photoUrl: string | null = null;
    if (candidate.photoFileId) {
      try {
        photoUrl = await createPresignedDownload(
          candidate.photoFileId,
          req.user!.organizationId,
        );
      } catch {
        photoUrl = null;
      }
    }

    const resumeDocs = await Resume.find({
      candidateId: candidate._id,
      organizationId: req.user!.organizationId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    const resumes = await Promise.all(
      resumeDocs.map(async (resume) => {
        const file = resume.fileId
          ? await FileObject.findOne({
              _id: resume.fileId,
              organizationId: req.user!.organizationId,
              isDeleted: false,
            }).lean()
          : null;
        let downloadUrl: string | null = null;
        if (resume.fileId) {
          try {
            downloadUrl = await createPresignedDownload(
              resume.fileId,
              req.user!.organizationId,
            );
          } catch {
            downloadUrl = null;
          }
        }
        const ext = file?.mime === "application/pdf" ? "pdf" : file?.mime?.split("/").pop() || "file";
        return {
          id: resume._id,
          fileId: resume.fileId,
          mime: file?.mime ?? null,
          size: file?.size ?? null,
          label: file ? `Resume.${ext}` : "Resume",
          parseStatus: resume.parseStatus,
          createdAt: resume.createdAt,
          downloadUrl,
        };
      }),
    );

    ok(res, {
      candidate: stripSalary({ ...candidate, id: candidate._id, photoUrl }, req.user!.role),
      applications,
      resumes,
    });
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/candidates/:id",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(
    z.object({
      fullName: z.string().optional(),
      phone: z.string().optional(),
      currentCity: z.string().optional(),
      preferredLocation: z.string().optional(),
      currentCompany: z.string().optional(),
      currentDesignation: z.string().optional(),
      totalExperience: z.number().optional(),
      relevantExperience: z.number().optional(),
      currentSalary: z.number().nullable().optional(),
      expectedSalary: z.number().nullable().optional(),
      noticePeriodDays: z.number().nullable().optional(),
      skills: z.array(z.string()).optional(),
      about: z.string().optional(),
      level: z.enum(["junior", "mid", "senior", "lead", "executive"]).optional(),
      tags: z.array(z.string()).optional(),
      photoFileId: z.string().optional(),
      workHistory: z.array(z.record(z.string(), z.unknown())).optional(),
      linkedinUrl: z.string().optional(),
      githubUrl: z.string().optional(),
      portfolioUrl: z.string().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const candidate = assertFound(
        await Candidate.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(candidate.organizationId, req.user!.organizationId);
      Object.assign(candidate, req.body);
      await candidate.save();
      ok(res, { candidate });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/applications", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const jobId = req.query.jobId as string | undefined;
    const stage = req.query.stage as string | undefined;
    const filter: Record<string, unknown> = {
      organizationId: req.user!.organizationId,
      isDeleted: false,
    };
    if (jobId) filter.jobId = jobId;
    if (stage) filter.stage = stage;

    const applications = await Application.find(filter)
      .populate("candidateId")
      .populate("jobId", "title slug")
      .sort({ updatedAt: -1 });
    ok(res, { applications });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/applications/:id/move",
  requireAuth,
  roleGuard("org_admin", "recruiter", "hiring_manager"),
  validate(
    z.object({
      stage: z.enum(PIPELINE_STAGES),
      note: z.string().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const application = assertFound(
        await Application.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(application.organizationId, req.user!.organizationId);
      const from = application.stage;
      application.stage = req.body.stage;
      if (req.body.note) {
        application.notes.push({
          body: req.body.note,
          authorId: req.user!.sub as unknown as typeof application.notes[0]["authorId"],
          createdAt: new Date(),
        });
      }
      await application.save();
      await PipelineEvent.create({
        organizationId: application.organizationId,
        applicationId: application._id,
        fromStage: from,
        toStage: application.stage,
        actorId: req.user!.sub,
        note: req.body.note ?? "",
      });
      await writeAudit({
        organizationId: application.organizationId,
        actorId: req.user!.sub,
        action: "application.move",
        entityType: "application",
        entityId: String(application._id),
        meta: { from, to: application.stage },
        ip: req.ip,
      });
      ok(res, { application });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/applications/:id/override",
  requireAuth,
  roleGuard("org_admin", "recruiter", "hiring_manager"),
  validate(z.object({ reason: z.string().min(3), stage: z.enum(PIPELINE_STAGES).optional() })),
  async (req: AuthedRequest, res, next) => {
    try {
      const application = assertFound(
        await Application.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(application.organizationId, req.user!.organizationId);
      application.override = {
        reason: req.body.reason,
        byUserId: req.user!.sub as never,
        at: new Date(),
      };
      if (req.body.stage) application.stage = req.body.stage;
      await application.save();
      await writeAudit({
        organizationId: application.organizationId,
        actorId: req.user!.sub,
        action: "application.override",
        entityType: "application",
        entityId: String(application._id),
        meta: {
          reason: req.body.reason,
          previousFitScore: application.fitScore,
          fitExplanation: application.fitExplanation,
        },
        ip: req.ip,
      });
      ok(res, { application });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/applications/:id/rescore",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  async (req: AuthedRequest, res, next) => {
    try {
      const application = assertFound(
        await Application.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(application.organizationId, req.user!.organizationId);
      const candidate = assertFound(await Candidate.findById(application.candidateId));
      const job = assertFound(await Job.findById(application.jobId));
      const org = assertFound(await Organization.findById(application.organizationId));
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
      application.fitScore = explanation.score;
      application.fitExplanation = explanation;
      application.eligibility = explanation.eligibility;
      await application.save();
      ok(res, { application });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
