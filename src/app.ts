import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/index.js";
import { isDbReady } from "./config/db.js";
import authRoutes from "./modules/auth/auth.routes.js";
import userRoutes from "./modules/users/user.routes.js";
import jobRoutes from "./modules/jobs/job.routes.js";
import candidateRoutes from "./modules/candidates/candidate.routes.js";
import fileRoutes from "./modules/files/file.routes.js";
import interviewRoutes from "./modules/interviews/interview.routes.js";
import offerRoutes from "./modules/offers/offer.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";

/** Strip Mongo operators from plain objects (Express 5–safe; do not reassign req.query). */
function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith("$") || k.includes(".")) continue;
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}

function sanitizeRequest(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  next();
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(
    helmet({
      // Allow the Vite SPA (different port) to read API responses in the browser
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(sanitizeRequest);

  if (env.NODE_ENV === "development") {
    app.use(morgan("dev"));
  }

  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok" } });
  });

  app.get("/ready", (_req, res) => {
    if (!isDbReady()) {
      res.status(503).json({
        success: false,
        error: { code: "NOT_READY", message: "Database not connected" },
      });
      return;
    }
    res.json({ success: true, data: { status: "ready" } });
  });

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const publicLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/api", apiLimiter);
  app.use("/api/v1/auth/login", authLimiter);
  app.use("/api/v1/auth/register", authLimiter);
  app.use("/api/v1/public", publicLimiter);

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1", userRoutes);
  app.use("/api/v1", jobRoutes);
  app.use("/api/v1", candidateRoutes);
  app.use("/api/v1", fileRoutes);
  app.use("/api/v1", interviewRoutes);
  app.use("/api/v1", offerRoutes);
  app.use("/api/v1", dashboardRoutes);

  app.use(errorHandler);
  return app;
}
