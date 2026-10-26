import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

let memory: MongoMemoryServer | null = null;

export async function connectDb(): Promise<void> {
  mongoose.set("strictQuery", true);
  const preferMemory =
    process.env.USE_MEMORY_MONGO === "true" || env.MONGODB_URI.includes("memory");

  if (preferMemory) {
    memory = await MongoMemoryServer.create();
    const uri = memory.getUri("hireflow");
    await mongoose.connect(uri);
    logger.info("MongoDB memory server connected");
    return;
  }

  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info("MongoDB connected");
  } catch (err) {
    logger.warn("MongoDB connection failed — falling back to in-memory server", {
      err: err instanceof Error ? err.message : String(err),
    });
    memory = await MongoMemoryServer.create();
    const uri = memory.getUri("hireflow");
    await mongoose.connect(uri);
    logger.info("MongoDB memory server connected (fallback)");
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memory) {
    await memory.stop();
    memory = null;
  }
}

export function isDbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
