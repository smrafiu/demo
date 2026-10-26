import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../users/user.model.js";
import { Organization } from "../organizations/organization.model.js";
import { Invite } from "../invites/invite.model.js";
import { Department } from "../departments/department.model.js";
import { requireAuth, roleGuard, validate, type AuthedRequest } from "../../middleware/index.js";
import { ok, AppError, assertFound, assertTenant } from "../../utils/http.js";
import { ROLES } from "../../types/domain.js";
import { randomToken, sha256 } from "../../utils/encryption.js";
import { sendEmail } from "../../services/email.service.js";
import { writeAudit } from "../../services/audit.service.js";
import { env } from "../../config/env.js";
import { createPresignedDownload } from "../../services/storage.service.js";

const router = Router();

router.get("/users/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = assertFound(
      await User.findOne({ _id: req.user!.sub, isDeleted: false }),
    );
    const org = assertFound(
      await Organization.findOne({ _id: user.organizationId, isDeleted: false }),
    );
    let avatarUrl: string | null = null;
    if (user.avatarFileId) {
      try {
        avatarUrl = await createPresignedDownload(user.avatarFileId, String(org._id));
      } catch {
        avatarUrl = null;
      }
    }
    let logoUrl: string | null = null;
    if (org.logoFileId) {
      try {
        logoUrl = await createPresignedDownload(org.logoFileId, String(org._id));
      } catch {
        logoUrl = null;
      }
    }
    ok(res, {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        title: user.title,
        organizationId: user.organizationId,
        avatarFileId: user.avatarFileId,
        avatarUrl,
      },
      organization: {
        id: org._id,
        name: org.name,
        slug: org.slug,
        industry: org.industry,
        website: org.website,
        address: org.address,
        country: org.country,
        timezone: org.timezone,
        currency: org.currency,
        logoFileId: org.logoFileId,
        logoUrl,
        careersAccentColor: org.careersAccentColor || "#171717",
      },
    });
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/users/me",
  requireAuth,
  validate(
    z.object({
      name: z.string().min(2).optional(),
      title: z.string().optional(),
      avatarFileId: z.string().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const user = assertFound(await User.findById(req.user!.sub));
      const body = req.body as { name?: string; title?: string; avatarFileId?: string };
      if (body.name) user.name = body.name;
      if (body.title !== undefined) user.title = body.title;
      if (body.avatarFileId) user.avatarFileId = body.avatarFileId as unknown as typeof user.avatarFileId;
      await user.save();
      ok(res, { user });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/organizations/current", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const org = assertFound(
      await Organization.findOne({ _id: req.user!.organizationId, isDeleted: false }),
    );
    ok(res, { organization: org });
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/organizations/current",
  requireAuth,
  roleGuard("org_admin"),
  validate(
    z.object({
      name: z.string().min(2).optional(),
      industry: z.string().optional(),
      website: z.string().optional(),
      address: z.string().optional(),
      timezone: z.string().optional(),
      currency: z.string().optional(),
      logoFileId: z.union([z.string(), z.null()]).optional(),
      careersAccentColor: z
        .string()
        .regex(/^#([0-9A-Fa-f]{6})$/, "Use a 6-digit hex color like #171717")
        .optional(),
      retentionMonths: z.number().int().positive().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const org = assertFound(
        await Organization.findOne({ _id: req.user!.organizationId, isDeleted: false }),
      );
      const body = req.body as {
        name?: string;
        industry?: string;
        website?: string;
        address?: string;
        timezone?: string;
        currency?: string;
        logoFileId?: string | null;
        careersAccentColor?: string;
        retentionMonths?: number;
      };
      if (body.name !== undefined) org.name = body.name;
      if (body.industry !== undefined) org.industry = body.industry;
      if (body.website !== undefined) org.website = body.website;
      if (body.address !== undefined) org.address = body.address;
      if (body.timezone !== undefined) org.timezone = body.timezone;
      if (body.currency !== undefined) org.currency = body.currency;
      if (body.retentionMonths !== undefined) org.retentionMonths = body.retentionMonths;
      if (body.careersAccentColor !== undefined) {
        org.careersAccentColor = body.careersAccentColor.toUpperCase();
      }
      if (body.logoFileId === null) {
        org.logoFileId = null;
      } else if (body.logoFileId !== undefined) {
        org.logoFileId = body.logoFileId as unknown as typeof org.logoFileId;
      }
      await org.save();
      ok(res, { organization: org });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/users", requireAuth, roleGuard("org_admin", "recruiter"), async (req: AuthedRequest, res, next) => {
  try {
    const users = await User.find({
      organizationId: req.user!.organizationId,
      isDeleted: false,
    }).select("-passwordHash -refreshTokenHash");
    ok(res, { users });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/invites",
  requireAuth,
  roleGuard("org_admin"),
  validate(
    z.object({
      email: z.string().email(),
      role: z.enum(ROLES),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const { email, role } = req.body as { email: string; role: (typeof ROLES)[number] };
      const token = randomToken(24);
      const invite = await Invite.create({
        organizationId: req.user!.organizationId,
        email: email.toLowerCase(),
        role,
        tokenHash: sha256(token),
        invitedBy: req.user!.sub,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      const link = `${env.CLIENT_URL}/invite/${token}`;
      await sendEmail({
        to: email,
        subject: "You're invited to HireFlow",
        html: `<p>You have been invited to join HireFlow as <strong>${role}</strong>.</p><p><a href="${link}">Accept invite</a></p>`,
      });
      await writeAudit({
        organizationId: req.user!.organizationId,
        actorId: req.user!.sub,
        action: "invite.create",
        entityType: "invite",
        entityId: String(invite._id),
        meta: { email, role },
        ip: req.ip,
      });
      ok(res, { inviteId: invite._id, inviteLink: link }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/invites/accept",
  validate(
    z.object({
      token: z.string().min(10),
      name: z.string().min(2),
      password: z.string().min(8),
    }),
  ),
  async (req, res, next) => {
    try {
      const { token, name, password } = req.body as {
        token: string;
        name: string;
        password: string;
      };
      const hash = sha256(token);
      const invite = await Invite.findOne({ status: "pending", tokenHash: hash });
      if (!invite || invite.expiresAt < new Date()) {
        throw new AppError(400, "INVALID_INVITE", "Invite is invalid or expired");
      }
      const exists = await User.findOne({
        organizationId: invite.organizationId,
        email: invite.email,
      });
      if (exists) throw new AppError(400, "EMAIL_IN_USE", "User already exists");

      const user = await User.create({
        organizationId: invite.organizationId,
        email: invite.email,
        name,
        role: invite.role,
        passwordHash: await bcrypt.hash(password, 12),
      });
      invite.status = "accepted";
      await invite.save();
      ok(res, { userId: user._id, email: user.email }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/departments", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const departments = await Department.find({
      organizationId: req.user!.organizationId,
      isDeleted: false,
    });
    ok(res, { departments });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/departments",
  requireAuth,
  roleGuard("org_admin"),
  validate(z.object({ name: z.string().min(2), headUserId: z.string().optional() })),
  async (req: AuthedRequest, res, next) => {
    try {
      const dept = await Department.create({
        organizationId: req.user!.organizationId,
        name: req.body.name,
        headUserId: req.body.headUserId ?? null,
      });
      ok(res, { department: dept }, 201);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
