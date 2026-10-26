import { Router } from "express";
import { z } from "zod";
import { Interview, Scorecard } from "./interview.model.js";
import { Application } from "../applications/application.model.js";
import { requireAuth, roleGuard, validate, type AuthedRequest } from "../../middleware/index.js";
import { ok, assertFound, assertTenant, AppError } from "../../utils/http.js";
import { writeAudit } from "../../services/audit.service.js";

const router = Router();

router.get("/interviews", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const filter: Record<string, unknown> = {
      organizationId: req.user!.organizationId,
      isDeleted: false,
    };
    if (from) filter.startsAt = { $gte: from };
    const interviews = await Interview.find(filter)
      .populate({
        path: "applicationId",
        populate: { path: "candidateId", select: "fullName currentDesignation photoFileId" },
      })
      .sort({ startsAt: 1 });
    ok(res, { interviews });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/interviews",
  requireAuth,
  roleGuard("org_admin", "recruiter"),
  validate(
    z.object({
      applicationId: z.string(),
      type: z
        .enum([
          "hr_screening",
          "technical",
          "assignment_review",
          "managerial",
          "cultural",
          "final",
        ])
        .optional(),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      meetingUrl: z.string().optional(),
      location: z.string().optional(),
      instructions: z.string().optional(),
      interviewerIds: z.array(z.string()).default([]),
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
      const interview = await Interview.create({
        organizationId: req.user!.organizationId,
        applicationId: application._id,
        type: req.body.type ?? "technical",
        startsAt: new Date(req.body.startsAt),
        endsAt: new Date(req.body.endsAt),
        meetingUrl: req.body.meetingUrl ?? "",
        location: req.body.location ?? "",
        instructions: req.body.instructions ?? "",
        interviewerIds: req.body.interviewerIds,
      });
      if (application.stage === "shortlisted" || application.stage === "screening_call") {
        application.stage = "interview";
        await application.save();
      }
      ok(res, { interview }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/interviews/:id/scorecards",
  requireAuth,
  validate(
    z.object({
      competencies: z.array(
        z.object({
          name: z.string(),
          rating: z.number().min(1).max(5),
          comment: z.string().optional(),
        }),
      ),
      recommendation: z.enum([
        "strong_hire",
        "hire",
        "neutral",
        "do_not_hire",
        "strong_do_not_hire",
      ]),
      overallNotes: z.string().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const interview = assertFound(
        await Interview.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(interview.organizationId, req.user!.organizationId);
      const isInterviewer =
        interview.interviewerIds.some((id) => String(id) === req.user!.sub) ||
        ["org_admin", "recruiter"].includes(req.user!.role);
      if (!isInterviewer) throw new AppError(404, "NOT_FOUND", "Resource not found");

      const scorecard = await Scorecard.findOneAndUpdate(
        { interviewId: interview._id, interviewerId: req.user!.sub },
        {
          organizationId: interview.organizationId,
          interviewId: interview._id,
          interviewerId: req.user!.sub,
          competencies: req.body.competencies,
          recommendation: req.body.recommendation,
          overallNotes: req.body.overallNotes ?? "",
          submittedAt: new Date(),
        },
        { upsert: true, new: true },
      );
      interview.status = "completed";
      await interview.save();
      await writeAudit({
        organizationId: interview.organizationId,
        actorId: req.user!.sub,
        action: "scorecard.submit",
        entityType: "scorecard",
        entityId: String(scorecard._id),
        ip: req.ip,
      });
      ok(res, { scorecard }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/interviews/:id/scorecards",
  requireAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const interview = assertFound(
        await Interview.findOne({ _id: req.params.id, isDeleted: false }),
      );
      assertTenant(interview.organizationId, req.user!.organizationId);

      const mine = await Scorecard.findOne({
        interviewId: interview._id,
        interviewerId: req.user!.sub,
      });
      const isAdmin = ["org_admin", "recruiter", "hiring_manager"].includes(req.user!.role);

      if (!mine && !isAdmin) {
        ok(res, { scorecards: [], locked: true });
        return;
      }

      const scorecards = await Scorecard.find({ interviewId: interview._id });
      ok(res, { scorecards, locked: false });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
