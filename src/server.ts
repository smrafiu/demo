import http from "node:http";
import { Server as SocketServer } from "socket.io";
import cron from "node-cron";
import { createApp } from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { verifyAccess } from "./utils/jwt.js";
import { Offer } from "./modules/offers/offer.model.js";
import { User } from "./modules/users/user.model.js";
import { seedInline } from "./scripts/seed-inline.js";

async function main() {
  await connectDb();

  const userCount = await User.countDocuments();
  if (userCount === 0) {
    logger.info("Seeding empty database in-process");
    await seedInline();
  }

  const app = createApp();
  const server = http.createServer(app);

  const io = new SocketServer(server, {
    cors: {
      origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization?.replace("Bearer ", "") as
          | string
          | undefined);
      if (!token) return next(new Error("Unauthorized"));
      socket.data.user = verifyAccess(token);
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const orgId = socket.data.user?.organizationId as string | undefined;
    if (orgId) socket.join(`org:${orgId}`);
  });

  cron.schedule("0 * * * *", async () => {
    const now = new Date();
    await Offer.updateMany(
      {
        status: { $in: ["sent", "viewed"] },
        validUntil: { $lt: now },
        isDeleted: false,
      },
      { status: "expired" },
    );
  });

  server.listen(env.PORT, () => {
    logger.info(`HireFlow API listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  logger.error("Failed to start server", { err: String(err) });
  process.exit(1);
});
