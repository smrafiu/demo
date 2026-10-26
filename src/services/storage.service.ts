import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuid } from "uuid";
import { env } from "../config/env.js";
import { FileObject } from "../modules/files/file.model.js";
import { AppError } from "../utils/http.js";
import type { Types } from "mongoose";

export const s3 = new S3Client({
  endpoint: env.KLOUDBEAN_S3_ENDPOINT,
  region: env.KLOUDBEAN_S3_REGION,
  forcePathStyle: env.KLOUDBEAN_S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.KLOUDBEAN_S3_ACCESS_KEY_ID,
    secretAccessKey: env.KLOUDBEAN_S3_SECRET_ACCESS_KEY,
  },
});

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const RESUME_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/rtf",
  "text/plain",
  "application/vnd.oasis.opendocument.text",
]);

export type FilePurpose =
  | "org_logo"
  | "user_avatar"
  | "candidate_photo"
  | "resume"
  | "offer_pdf"
  | "brand_asset"
  | "other";

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/rtf": "rtf",
    "text/rtf": "rtf",
    "text/plain": "txt",
    "application/vnd.oasis.opendocument.text": "odt",
  };
  return map[mime] ?? "bin";
}

export function buildObjectKey(params: {
  organizationId: string;
  purpose: FilePurpose;
  userId?: string;
  candidateId?: string;
  offerId?: string;
  mime: string;
}): string {
  const id = uuid();
  const ext = extFromMime(params.mime);
  const org = params.organizationId;
  switch (params.purpose) {
    case "org_logo":
      return `org/${org}/logo/${id}.${ext}`;
    case "user_avatar":
      return `org/${org}/users/${params.userId ?? "unknown"}/avatar/${id}.${ext}`;
    case "candidate_photo":
      return `org/${org}/candidates/${params.candidateId ?? "unknown"}/photo/${id}.${ext}`;
    case "resume":
      return `org/${org}/candidates/${params.candidateId ?? "unknown"}/resume/${id}.${ext}`;
    case "offer_pdf":
      return `org/${org}/offers/${params.offerId ?? "unknown"}/${id}.pdf`;
    case "brand_asset":
      return `public/brand/${id}.${ext}`;
    default:
      return `org/${org}/other/${id}.${ext}`;
  }
}

export function assertMimeAndSize(purpose: FilePurpose, mime: string, size: number): void {
  if (purpose === "resume") {
    if (!RESUME_MIMES.has(mime)) {
      throw new AppError(400, "INVALID_MIME", "Unsupported resume type");
    }
    if (size > env.MAX_RESUME_BYTES) {
      throw new AppError(400, "FILE_TOO_LARGE", "Resume exceeds size limit");
    }
    return;
  }
  if (purpose === "offer_pdf") {
    if (mime !== "application/pdf") {
      throw new AppError(400, "INVALID_MIME", "Offer must be PDF");
    }
    return;
  }
  if (!IMAGE_MIMES.has(mime) && purpose !== "other") {
    throw new AppError(400, "INVALID_MIME", "Unsupported image type");
  }
  if (IMAGE_MIMES.has(mime) && size > env.MAX_IMAGE_BYTES) {
    throw new AppError(400, "FILE_TOO_LARGE", "Image exceeds size limit");
  }
}

export async function createPresignedUpload(params: {
  organizationId: string;
  purpose: FilePurpose;
  mime: string;
  size: number;
  ownerUserId?: string;
  userId?: string;
  candidateId?: string;
  offerId?: string;
}): Promise<{ uploadUrl: string; fileId: string; key: string }> {
  assertMimeAndSize(params.purpose, params.mime, params.size);
  const key = buildObjectKey(params);
  const file = await FileObject.create({
    organizationId: params.organizationId || null,
    key,
    bucket: env.KLOUDBEAN_S3_BUCKET,
    mime: params.mime,
    size: params.size,
    purpose: params.purpose,
    ownerUserId: params.ownerUserId ?? null,
  });

  const command = new PutObjectCommand({
    Bucket: env.KLOUDBEAN_S3_BUCKET,
    Key: key,
    ContentType: params.mime,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
  return { uploadUrl, fileId: String(file._id), key };
}

export async function createPresignedDownload(
  fileId: string | Types.ObjectId,
  organizationId?: string,
): Promise<string> {
  const file = await FileObject.findOne({
    _id: fileId,
    isDeleted: false,
    ...(organizationId ? { organizationId } : {}),
  });
  if (!file) throw new AppError(404, "NOT_FOUND", "File not found");

  const command = new GetObjectCommand({
    Bucket: file.bucket,
    Key: file.key,
  });
  return getSignedUrl(s3, command, { expiresIn: 900 });
}

export async function uploadBuffer(params: {
  organizationId: string;
  purpose: FilePurpose;
  mime: string;
  body: Buffer;
  ownerUserId?: string;
  offerId?: string;
}): Promise<Types.ObjectId> {
  assertMimeAndSize(params.purpose, params.mime, params.body.length);
  const key = buildObjectKey({
    organizationId: params.organizationId,
    purpose: params.purpose,
    mime: params.mime,
    offerId: params.offerId,
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: env.KLOUDBEAN_S3_BUCKET,
      Key: key,
      Body: params.body,
      ContentType: params.mime,
    }),
  );
  const file = await FileObject.create({
    organizationId: params.organizationId,
    key,
    bucket: env.KLOUDBEAN_S3_BUCKET,
    mime: params.mime,
    size: params.body.length,
    purpose: params.purpose,
    ownerUserId: params.ownerUserId ?? null,
  });
  return file._id;
}

export async function softDeleteFile(fileId: string, organizationId: string): Promise<void> {
  await FileObject.findOneAndUpdate(
    { _id: fileId, organizationId },
    { isDeleted: true, deletedAt: new Date() },
  );
}

export async function hardDeleteObject(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.KLOUDBEAN_S3_BUCKET,
      Key: key,
    }),
  );
}
