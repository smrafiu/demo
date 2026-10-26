import { Router } from "express";
import { requireAuth, roleGuard, type AuthedRequest } from "../../middleware/index.js";
import { ok } from "../../utils/http.js";
import { Job } from "../jobs/job.model.js";
import { Candidate } from "../candidates/candidate.model.js";
import { Application } from "../applications/application.model.js";
import { Interview } from "../interviews/interview.model.js";
import { Offer } from "../offers/offer.model.js";
import { Notification, AuditLog } from "../auditLogs/audit.model.js";
import {
  bump,
  countryDisplayName,
  mapToSortedRows,
  normalizeCountryCode,
  resolveIndiaState,
} from "../../utils/geo.js";

const router = Router();

function buildGeoBuckets(
  rows: Array<{ country?: string | null; city?: string | null; location?: string | null }>,
) {
  const countries = new Map<string, number>();
  const statesByCountry: Record<string, Map<string, number>> = {};

  for (const row of rows) {
    const code = normalizeCountryCode(row.country || undefined);
    if (code === "UNK" && !row.city && !row.location) continue;
    const countryCode = code === "UNK" ? "IN" : code;
    bump(countries, countryCode);

    if (countryCode === "IN") {
      const state = resolveIndiaState(row.city, row.location);
      if (state) {
        statesByCountry.IN ??= new Map();
        bump(statesByCountry.IN, state);
      }
    }
  }

  return {
    countries: mapToSortedRows(countries, countryDisplayName),
    statesByCountry: Object.fromEntries(
      Object.entries(statesByCountry).map(([cc, map]) => [
        cc,
        mapToSortedRows(map, (name) => name),
      ]),
    ),
  };
}

router.get("/dashboard/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();

    const [upcomingInterviews, vacancies, candidates, allCandidates, allJobs, applications, notifications, unread] =
      await Promise.all([
        Interview.find({
          organizationId: orgId,
          isDeleted: false,
          status: "scheduled",
          startsAt: { $gte: now },
        })
          .sort({ startsAt: 1 })
          .limit(5)
          .populate({
            path: "applicationId",
            populate: {
              path: "candidateId",
              select: "fullName currentDesignation currentCity photoFileId",
            },
          })
          .populate({ path: "interviewerIds", select: "name" }),
        Job.find({
          organizationId: orgId,
          isDeleted: false,
          status: { $in: ["open", "paused"] },
        })
          .sort({ updatedAt: -1 })
          .limit(6),
        Candidate.find({ organizationId: orgId, isDeleted: false })
          .sort({ createdAt: -1 })
          .limit(8)
          .select(
            "fullName currentCity currentDesignation level country photoFileId preferredLocation",
          ),
        Candidate.find({ organizationId: orgId, isDeleted: false }).select(
          "_id country currentCity preferredLocation",
        ),
        Job.find({ organizationId: orgId, isDeleted: false }).select(
          "_id title country location department employmentType workplaceType",
        ),
        Application.find({ organizationId: orgId, isDeleted: false }).select(
          "fitScore stage jobId candidateId",
        ),
        Notification.find({ userId: req.user!.sub }).sort({ createdAt: -1 }).limit(10),
        Notification.countDocuments({ userId: req.user!.sub, readAt: null }),
      ]);

    const jobById = new Map(allJobs.map((j) => [String(j._id), j]));
    const candidateById = new Map(allCandidates.map((c) => [String(c._id), c]));

    const companyFootprints = allJobs.map((j) => ({
      country: j.country,
      city: j.location,
      location: j.location,
      jobId: String(j._id),
      jobTitle: j.title,
      employmentType: j.employmentType,
      workplaceType: j.workplaceType,
    }));

    const candidateFootprints: Array<{
      country?: string | null;
      city?: string | null;
      location?: string | null;
      jobId: string;
      jobTitle: string;
      employmentType: string;
      workplaceType: string;
    }> = [];
    for (const app of applications) {
      const cand = candidateById.get(String(app.candidateId));
      const job = jobById.get(String(app.jobId));
      if (!cand || !job) continue;
      candidateFootprints.push({
        country: cand.country,
        city: cand.currentCity,
        location: cand.preferredLocation,
        jobId: String(job._id),
        jobTitle: job.title,
        employmentType: job.employmentType,
        workplaceType: job.workplaceType,
      });
    }

    const openings = [...allJobs]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((j) => ({ id: String(j._id), title: j.title }));

    const candidatesGeo = buildGeoBuckets(
      allCandidates.map((c) => ({
        country: c.country,
        city: c.currentCity,
        location: c.preferredLocation,
      })),
    );
    const companiesGeo = buildGeoBuckets(
      allJobs.map((j) => ({
        country: j.country,
        city: j.location,
        location: j.location,
      })),
    );

    // Keep a simple countries list for backward compat (candidate country counts)
    const countries = candidatesGeo.countries.map((c) => ({
      name: c.code,
      value: c.value,
    }));

    const industriesMap = new Map<string, number>();
    for (const job of allJobs) {
      const key = job.department?.trim() || "General";
      bump(industriesMap, key);
    }
    const totalJobs = Math.max(1, allJobs.length);
    const industries = mapToSortedRows(industriesMap)
      .slice(0, 6)
      .map((row) => ({
        name: row.name,
        value: Math.round((row.value / totalJobs) * 100),
      }));

    ok(res, {
      upcomingInterviews,
      vacancies,
      potentialCandidates: candidates,
      industries,
      countries,
      geo: {
        candidates: candidatesGeo,
        companies: companiesGeo,
        openings,
        employmentTypes: ["full_time", "part_time", "contract", "intern"],
        workplaceTypes: ["onsite", "hybrid", "remote"],
        candidateFootprints,
        companyFootprints,
      },
      notifications,
      unreadNotifications: unread,
      unreadMessages: Math.max(0, unread - 1),
      applicationCount: applications.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/analytics", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const applications = await Application.find({
      organizationId: orgId,
      isDeleted: false,
    }).select("stage fitScore");
    const byStage: Record<string, number> = {};
    const scoreBuckets = { "0-40": 0, "41-60": 0, "61-80": 0, "81-100": 0 };
    for (const a of applications) {
      byStage[a.stage] = (byStage[a.stage] ?? 0) + 1;
      const s = a.fitScore ?? 0;
      if (s <= 40) scoreBuckets["0-40"] += 1;
      else if (s <= 60) scoreBuckets["41-60"] += 1;
      else if (s <= 80) scoreBuckets["61-80"] += 1;
      else scoreBuckets["81-100"] += 1;
    }
    const offers = await Offer.countDocuments({ organizationId: orgId, isDeleted: false });
    const accepted = await Offer.countDocuments({
      organizationId: orgId,
      status: "accepted",
      isDeleted: false,
    });
    ok(res, { byStage, scoreBuckets, offers, accepted });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/audit-logs",
  requireAuth,
  roleGuard("org_admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const logs = await AuditLog.find({ organizationId: req.user!.organizationId })
        .sort({ createdAt: -1 })
        .limit(100);
      ok(res, { logs });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/notifications", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const notifications = await Notification.find({ userId: req.user!.sub })
      .sort({ createdAt: -1 })
      .limit(30);
    ok(res, { notifications });
  } catch (err) {
    next(err);
  }
});

router.get("/reports/candidates.csv", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const candidates = await Candidate.find({
      organizationId: req.user!.organizationId,
      isDeleted: false,
    }).limit(1000);
    const header = "name,email,city,designation,level,skills\n";
    const rows = candidates
      .map((c) =>
        [
          c.fullName,
          c.email,
          c.currentCity,
          c.currentDesignation,
          c.level,
          c.skills.join("|"),
        ]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=candidates.csv");
    res.send(header + rows);
  } catch (err) {
    next(err);
  }
});

export default router;
