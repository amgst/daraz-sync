import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

// SQLite + a single long-running Node process: one PrismaClient for the
// life of the process is exactly right here, no serverless connection-pool
// concerns like the old Postgres/pgbouncer setup had.
const db = global.prismaGlobal ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = db;
}

export default db;
