import { Router } from "express";
import { z } from "zod";
import { requireAuth, validate, type AuthedRequest } from "../../middleware/index.js";
import { ok, assertFound, assertTenant } from "../../utils/http.js";
import {
  createPresignedUpload,
  createPresignedDownload,
} from "../../services/storage.service.js";
import { FileObject } from "./file.model.js";

const router = Router();

router.post(
  "/files/presign-upload",
  requireAuth,
  validate(
    z.object({
      purpose: z.enum([
        "org_logo",
        "user_avatar",
        "candidate_photo",
        "resume",
        "offer_pdf",
        "brand_asset",
        "other",
      ]),
      mime: z.string().min(3),
      size: z.number().int().positive(),
      candidateId: z.string().optional(),
      offerId: z.string().optional(),
    }),
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as {
        purpose:
          | "org_logo"
          | "user_avatar"
          | "candidate_photo"
          | "resume"
          | "offer_pdf"
          | "brand_asset"
          | "other";
        mime: string;
        size: number;
        candidateId?: string;
        offerId?: string;
      };
      const result = await createPresignedUpload({
        organizationId: req.user!.organizationId,
        purpose: body.purpose,
        mime: body.mime,
        size: body.size,
        ownerUserId: req.user!.sub,
        userId: req.user!.sub,
        candidateId: body.candidateId,
        offerId: body.offerId,
      });
      ok(res, result, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/files/confirm",
  requireAuth,
  validate(z.object({ fileId: z.string() })),
  async (req: AuthedRequest, res, next) => {
    try {
      const file = assertFound(
        await FileObject.findOne({
          _id: req.body.fileId,
          isDeleted: false,
        }),
      );
      assertTenant(file.organizationId, req.user!.organizationId);
      ok(res, { file });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/files/:id/presign-download", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const url = await createPresignedDownload(String(req.params.id), req.user!.organizationId);
    ok(res, { url });
  } catch (err) {
    next(err);
  }
});

export default router;
