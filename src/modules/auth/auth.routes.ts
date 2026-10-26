import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import slugify from "slugify";
import { Organization } from "../organizations/organization.model.js";
import { User } from "../users/user.model.js";
import { OfferTemplate } from "../offers/offer.model.js";
import { validate, requireAuth, type AuthedRequest } from "../../middleware/index.js";
import { ok, AppError, assertFound } from "../../utils/http.js";
import { signAccess, signRefresh, verifyRefresh } from "../../utils/jwt.js";
import { env } from "../../config/env.js";
import { writeAudit } from "../../services/audit.service.js";
import { ROLES } from "../../types/domain.js";

const router = Router();

const registerSchema = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  industry: z.string().optional(),
  country: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setRefreshCookie(res: import("express").Response, token: string): void {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/api/v1/auth",
  });
}

function clearRefreshCookie(res: import("express").Response): void {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
  });
}

async function issueTokens(user: InstanceType<typeof User>) {
  const accessToken = signAccess({
    sub: String(user._id),
    organizationId: String(user.organizationId),
    role: user.role,
    email: user.email,
  });
  const refreshToken = signRefresh({ sub: String(user._id) });
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  user.lastLoginAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();
  return { accessToken, refreshToken };
}

router.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof registerSchema>;
    const existing = await User.findOne({ email: body.email.toLowerCase(), isDeleted: false });
    if (existing) throw new AppError(400, "EMAIL_IN_USE", "Unable to register with this email");

    let slug = slugify(body.organizationName, { lower: true, strict: true });
    const slugTaken = await Organization.findOne({ slug });
    if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

    const org = await Organization.create({
      name: body.organizationName,
      slug,
      industry: body.industry ?? "",
      country: body.country ?? "IN",
    });

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await User.create({
      organizationId: org._id,
      email: body.email.toLowerCase(),
      passwordHash,
      name: body.name,
      role: "org_admin",
      title: "Administrator",
    });

    await OfferTemplate.create({
      organizationId: org._id,
      name: "Full-time Employee",
      employmentType: "full_time",
      body: `Dear {{candidateName}},\n\nWe are delighted to offer you the position of {{jobTitle}} at {{companyName}}. Your annual CTC will be {{annualCtc}}. Joining date: {{joiningDate}}.\n\nWelcome aboard!\n{{companyName}}`,
    });

    const tokens = await issueTokens(user);
    setRefreshCookie(res, tokens.refreshToken);
    await writeAudit({
      organizationId: org._id,
      actorId: user._id,
      action: "org.register",
      entityType: "organization",
      entityId: String(org._id),
      ip: req.ip,
    });

    ok(
      res,
      {
        accessToken: tokens.accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: org._id,
        },
        organization: { id: org._id, name: org.name, slug: org.slug },
      },
      201,
    );
  } catch (err) {
    next(err);
  }
});

router.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof loginSchema>;
    const user = await User.findOne({
      email: body.email.toLowerCase(),
      isDeleted: false,
      status: "active",
    });
    if (!user) throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

    if (user.lockUntil && user.lockUntil > new Date()) {
      throw new AppError(401, "ACCOUNT_LOCKED", "Account temporarily locked. Try again later.");
    }

    const match = await bcrypt.compare(body.password, user.passwordHash);
    if (!match) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.failedLoginAttempts = 0;
      }
      await user.save();
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const tokens = await issueTokens(user);
    setRefreshCookie(res, tokens.refreshToken);
    ok(res, {
      accessToken: tokens.accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        title: user.title,
        organizationId: user.organizationId,
        avatarFileId: user.avatarFileId,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken as string | undefined;
    if (!token) throw new AppError(401, "UNAUTHORIZED", "Refresh token missing");

    let payload: { sub: string };
    try {
      payload = verifyRefresh(token);
    } catch {
      clearRefreshCookie(res);
      throw new AppError(401, "UNAUTHORIZED", "Invalid refresh token");
    }

    const user = await User.findById(payload.sub);
    if (!user || user.isDeleted || user.status !== "active" || !user.refreshTokenHash) {
      clearRefreshCookie(res);
      throw new AppError(401, "UNAUTHORIZED", "Invalid refresh token");
    }

    const valid = await bcrypt.compare(token, user.refreshTokenHash);
    if (!valid) {
      user.refreshTokenHash = null;
      await user.save();
      clearRefreshCookie(res);
      throw new AppError(401, "UNAUTHORIZED", "Refresh token reuse detected");
    }

    const tokens = await issueTokens(user);
    setRefreshCookie(res, tokens.refreshToken);
    ok(res, { accessToken: tokens.accessToken });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await User.findById(req.user!.sub);
    if (user) {
      user.refreshTokenHash = null;
      await user.save();
    }
    clearRefreshCookie(res);
    ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
});

router.get("/roles", (_req, res) => {
  ok(res, { roles: ROLES });
});

export default router;
