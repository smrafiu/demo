import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodType } from "zod";
import { AppError, fail } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { verifyAccess, type AccessPayload } from "../utils/jwt.js";

export type AuthedRequest = Request & { user?: AccessPayload };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    fail(res, 401, "UNAUTHORIZED", "Authentication required");
    return;
  }
  try {
    req.user = verifyAccess(header.slice(7));
    next();
  } catch {
    fail(res, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
}

export function roleGuard(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      fail(res, 404, "NOT_FOUND", "Resource not found");
      return;
    }
    next();
  };
}

type RequestPart = "body" | "query" | "params";

export function validate(schema: ZodType, part: RequestPart = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[part]);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fields[issue.path.join(".") || part] = issue.message;
      }
      fail(res, 400, "VALIDATION_ERROR", "Validation failed", fields);
      return;
    }
    (req as Request & Record<string, unknown>)[part] = parsed.data;
    next();
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    fail(res, err.statusCode, err.code, err.message, err.fields);
    return;
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      fields[issue.path.join(".") || "body"] = issue.message;
    }
    fail(res, 400, "VALIDATION_ERROR", "Validation failed", fields);
    return;
  }
  logger.error("Unhandled error", {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  fail(res, 500, "INTERNAL_ERROR", "Something went wrong");
}
