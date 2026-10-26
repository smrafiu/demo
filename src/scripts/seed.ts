import "dotenv/config";
import { connectDb, disconnectDb } from "../config/db.js";
import { seedInline } from "./seed-inline.js";

async function seed() {
  await connectDb();
  await seedInline();
  await disconnectDb();
}

seed().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
