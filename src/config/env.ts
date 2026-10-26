import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5003),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  CLIENT_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(64),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  KLOUDBEAN_S3_ENDPOINT: z.string().url(),
  KLOUDBEAN_S3_REGION: z.string().default("auto"),
  KLOUDBEAN_S3_BUCKET: z.string().min(1),
  KLOUDBEAN_S3_ACCESS_KEY_ID: z.string().min(1),
  KLOUDBEAN_S3_SECRET_ACCESS_KEY: z.string().min(1),
  KLOUDBEAN_S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  KLOUDBEAN_S3_PUBLIC_BASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  NOIRLY_API_KEY: z.string().optional(),
  NOIRLY_BASE_URL: z.string().url().default("https://noirly.ai"),
  NOIRLY_DEFAULT_MODEL: z
    .enum(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"])
    .default("gpt-5.6-sol"),
  MAX_RESUME_BYTES: z.coerce.number().default(10_485_760),
  MAX_IMAGE_BYTES: z.coerce.number().default(5_242_880),
  SENTRY_DSN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
