import { Router } from "express";
import { z } from "zod";
import { Offer, OfferApproval, OfferTemplate } from "./offer.model.js";
import { Application } from "../applications/application.model.js";
import { Candidate } from "../candidates/candidate.model.js";
import { Job } from "../jobs/job.model.js";
import { Organization } from "../organizations/organization.model.js";
import { requireAuth, roleGuard, validate, type AuthedRequest } from "../../middleware/index.js";
import { ok, assertFound, assertTenant, AppError } from "../../utils/http.js";
import { randomToken, sha256 } from "../../utils/encryption.js";
import { buildOfferPdf, sendEmail } from "../../services/email.service.js";
import { uploadBuffer, createPresignedDownload } from "../../services/storage.service.js";
import { writeAudit } from "../../services/audit.service.js";
import { env } from "../../config/env.js";

const router = Router();

const salarySchema = z.object({
  basic: z.number().default(0),
  hra: z.number().default(0),
  specialAllowance: z.number().default(0),
  variablePay: z.number().default(0),
  performanceBonus: z.number().default(0),
  joiningBonus: z.number().default(0),
  employerPf: z.number().default(0),
  gratuity: z.number().default(0),
  insurance: z.number().default(0),
  other: z.number().default(0),
  annualCtc: z.number().positive(),
  monthlyGross: z.number().optional(),
  currency: z.string().default("INR"),
});

router.get("/offer-templates", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const templates = await OfferTemplate.find({
      organizationId: req.user!.organizationId,
      isDeleted: false,
    });
    ok(res, { templates });
  } catch (err) {
    next(err);
  }
});

router.get("/offers", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const offers = await Offer.find({
      organizationId: req.user!.organizationId,
      isDeleted: false,
    }).sort({ updatedAt: -1 });
    ok(res, { offers });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/offers",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(
    z.object({
      applicationId: z.string(),
      templateId: z.string().optional(),
      jobTitle: z.string().min(2),
      joiningDate: z.string().optional(),
      reportingManager: z.string().optional(),
      workLocation: z.string().optional(),
      probationMonths: z.number().optional(),
      noticePeriodDays: z.number().optional(),
      validUntil: z.string().optional(),
      benefits: z.string().optional(),
      specialConditions: z.string().optional(),
      letterBody: z.string().optional(),
      salary: salarySchema,
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const application = assertFound(
        await Application.findOne({
          _id: req.body.applicationId,
          isDeleted: false,
        }),
      );
      assertTenant(application.organizationId, req.user!.organizationId);

      const components =
        req.body.salary.basic +
        req.body.salary.hra +
        req.body.salary.specialAllowance +
        req.body.salary.variablePay +
        req.body.salary.performanceBonus +
        req.body.salary.joiningBonus +
        req.body.salary.employerPf +
        req.body.salary.gratuity +
        req.body.salary.insurance +
        req.body.salary.other;
      const warning =
        components > 0 && Math.abs(components - req.body.salary.annualCtc) > 1
          ? "Salary components do not sum to annual CTC"
          : null;

      const monthlyGross =
        req.body.salary.monthlyGross ?? Math.round(req.body.salary.annualCtc / 12);

      const offer = await Offer.create({
        organizationId: req.user!.organizationId,
        applicationId: application._id,
        templateId: req.body.templateId ?? null,
        jobTitle: req.body.jobTitle,
        joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate) : null,
        reportingManager: req.body.reportingManager ?? "",
        workLocation: req.body.workLocation ?? "",
        probationMonths: req.body.probationMonths ?? 3,
        noticePeriodDays: req.body.noticePeriodDays ?? 30,
        validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null,
        benefits: req.body.benefits ?? "",
        specialConditions: req.body.specialConditions ?? "",
        letterBody: req.body.letterBody ?? "",
        salary: { ...req.body.salary, monthlyGross },
        status: "draft",
      });

      ok(res, { offer, warning }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/offers/:id/submit-approval",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  async (req: AuthedRequest, res, next) => {
    try {
      const offer = assertFound(
        await Offer.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(offer.organizationId, req.user!.organizationId);
      if (offer.status === "accepted") {
        throw new AppError(400, "IMMUTABLE", "Accepted offers cannot be edited");
      }
      offer.status = "awaiting_approval";
      await offer.save();
      await OfferApproval.deleteMany({ offerId: offer._id });
      await OfferApproval.insertMany([
        {
          organizationId: offer.organizationId,
          offerId: offer._id,
          step: 1,
          approverRole: "hiring_manager",
        },
        {
          organizationId: offer.organizationId,
          offerId: offer._id,
          step: 2,
          approverRole: "finance_approver",
        },
        {
          organizationId: offer.organizationId,
          offerId: offer._id,
          step: 3,
          approverRole: "org_admin",
        },
      ]);
      const application = await Application.findById(offer.applicationId);
      if (application) {
        application.stage = "offer_approval";
        await application.save();
      }
      ok(res, { offer });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/offers/:id/decide",
  requireAuth,
  validate(
    z.object({
      decision: z.enum(["approved", "rejected", "changes_requested"]),
      note: z.string().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const offer = assertFound(
        await Offer.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(offer.organizationId, req.user!.organizationId);
      const pending = await OfferApproval.findOne({
        offerId: offer._id,
        decision: "pending",
      }).sort({ step: 1 });
      if (!pending) throw new AppError(400, "NO_PENDING", "No pending approval step");

      const role = req.user!.role;
      const allowed =
        role === pending.approverRole ||
        role === "org_admin" ||
        (pending.approverRole === "org_admin" && role === "org_admin");
      if (!allowed) throw new AppError(404, "NOT_FOUND", "Resource not found");

      pending.decision = req.body.decision;
      pending.note = req.body.note ?? "";
      pending.approverUserId = req.user!.sub as unknown as typeof pending.approverUserId;
      pending.decidedAt = new Date();
      await pending.save();

      if (req.body.decision === "rejected" || req.body.decision === "changes_requested") {
        offer.status =
          req.body.decision === "rejected" ? "draft" : "changes_requested";
        await offer.save();
      } else {
        const stillPending = await OfferApproval.countDocuments({
          offerId: offer._id,
          decision: "pending",
        });
        if (stillPending === 0) {
          offer.status = "approved";
          await offer.save();
        }
      }

      await writeAudit({
        organizationId: offer.organizationId,
        actorId: req.user!.sub,
        action: "offer.decide",
        entityType: "offer",
        entityId: String(offer._id),
        meta: { decision: req.body.decision },
        ip: req.ip,
      });
      ok(res, { offer, approval: pending });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/offers/:id/send",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  async (req: AuthedRequest, res, next) => {
    try {
      const offer = assertFound(
        await Offer.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(offer.organizationId, req.user!.organizationId);
      if (!["approved", "sent"].includes(offer.status)) {
        throw new AppError(400, "NOT_APPROVED", "Offer must be approved before sending");
      }

      const application = assertFound(await Application.findById(offer.applicationId));
      const candidate = assertFound(await Candidate.findById(application.candidateId));
      const org = assertFound(await Organization.findById(offer.organizationId));

      const token = randomToken(24);
      offer.accessTokenHash = sha256(token);

      const pdf = await buildOfferPdf({
        companyName: org.name,
        candidateName: candidate.fullName,
        jobTitle: offer.jobTitle,
        letterBody: offer.letterBody,
        annualCtc: offer.salary.annualCtc,
        currency: offer.salary.currency,
        joiningDate: offer.joiningDate?.toISOString().slice(0, 10),
        documentId: String(offer._id),
      });

      const pdfFileId = await uploadBuffer({
        organizationId: String(org._id),
        purpose: "offer_pdf",
        mime: "application/pdf",
        body: pdf,
        ownerUserId: req.user!.sub,
        offerId: String(offer._id),
      });

      offer.pdfFileId = pdfFileId;
      offer.status = "sent";
      offer.sentAt = new Date();
      await offer.save();

      application.stage = "offer_sent";
      await application.save();

      const link = `${env.CLIENT_URL}/offer/${token}`;
      await sendEmail({
        to: candidate.email,
        subject: `Offer from ${org.name}`,
        html: `<p>Hello ${candidate.fullName},</p><p>You have received an offer for <strong>${offer.jobTitle}</strong>.</p><p><a href="${link}">View offer</a></p>`,
      });

      await writeAudit({
        organizationId: offer.organizationId,
        actorId: req.user!.sub,
        action: "offer.send",
        entityType: "offer",
        entityId: String(offer._id),
        ip: req.ip,
      });

      ok(res, { offer, candidateLink: link });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/public/offers/:token", async (req, res, next) => {
  try {
      const hash = sha256(String(req.params.token));
    const offer = assertFound(
      await Offer.findOne({
        accessTokenHash: hash,
        status: { $in: ["sent", "viewed", "accepted", "rejected"] },
        isDeleted: false,
      }),
    );
    const now = new Date();
    if (!offer.firstViewedAt) offer.firstViewedAt = now;
    offer.lastViewedAt = now;
    if (offer.status === "sent") offer.status = "viewed";
    await offer.save();

    const application = assertFound(await Application.findById(offer.applicationId));
    const candidate = assertFound(await Candidate.findById(application.candidateId));
    const org = assertFound(await Organization.findById(offer.organizationId));
    let pdfUrl: string | null = null;
    if (offer.pdfFileId) {
      try {
        pdfUrl = await createPresignedDownload(offer.pdfFileId, String(org._id));
      } catch {
        pdfUrl = null;
      }
    }

    ok(res, {
      offer: {
        id: offer._id,
        jobTitle: offer.jobTitle,
        status: offer.status,
        joiningDate: offer.joiningDate,
        workLocation: offer.workLocation,
        letterBody: offer.letterBody,
        benefits: offer.benefits,
        salary: {
          annualCtc: offer.salary.annualCtc,
          currency: offer.salary.currency,
          monthlyGross: offer.salary.monthlyGross,
        },
        pdfUrl,
      },
      candidate: { name: candidate.fullName, email: candidate.email },
      organization: { name: org.name },
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/public/offers/:token/respond",
  validate(
    z.object({
      decision: z.enum(["accepted", "rejected"]),
      comment: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const hash = sha256(String(req.params.token));
      const offer = assertFound(
        await Offer.findOne({
          accessTokenHash: hash,
          status: { $in: ["sent", "viewed"] },
          isDeleted: false,
        }),
      );
      offer.status = req.body.decision;
      offer.candidateComment = req.body.comment ?? "";
      offer.decidedAt = new Date();
      await offer.save();

      const application = await Application.findById(offer.applicationId);
      if (application) {
        application.stage =
          req.body.decision === "accepted" ? "offer_accepted" : "offer_declined";
        await application.save();
      }
      if (req.body.decision === "accepted" && application) {
        const job = await Job.findById(application.jobId);
        if (job) {
          job.filledCount = Math.min(job.vacancies, job.filledCount + 1);
          if (job.filledCount >= job.vacancies) job.status = "filled";
          await job.save();
        }
      }
      await writeAudit({
        organizationId: offer.organizationId,
        action: "offer.candidate_response",
        entityType: "offer",
        entityId: String(offer._id),
        meta: { decision: req.body.decision },
        ip: req.ip,
      });
      ok(res, { status: offer.status });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
