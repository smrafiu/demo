import winston from "winston";
import { env } from "../config/env.js";

export const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  format:
    env.NODE_ENV === "production"
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json(),
        )
      : winston.format.combine(
          winston.format.colorize({ all: true }),
          winston.format.timestamp({ format: "HH:mm:ss" }),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
            return `${timestamp} ${level}: ${message}${rest}`;
          }),
        ),
  transports: [new winston.transports.Console()],
});
