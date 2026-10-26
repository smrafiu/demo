import type { Response } from "express";
import { Types } from "mongoose";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function fail(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): void {
  res.status(statusCode).json({
    success: false,
    error: { code, message, ...(fields ? { fields } : {}) },
  });
}

export function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(400, "INVALID_ID", "Invalid identifier");
  }
  return new Types.ObjectId(id);
}

/** Always 404 for wrong tenant / missing resource — never leak existence via 403. */
export function assertFound<T>(
  doc: T,
  message = "Resource not found",
): Exclude<T, null | undefined> {
  if (doc === null || doc === undefined) {
    throw new AppError(404, "NOT_FOUND", message);
  }
  return doc as Exclude<T, null | undefined>;
}

export function assertTenant(
  resourceOrgId: string | Types.ObjectId | undefined | null,
  userOrgId: string,
): void {
  if (!resourceOrgId || String(resourceOrgId) !== String(userOrgId)) {
    throw new AppError(404, "NOT_FOUND", "Resource not found");
  }
}
