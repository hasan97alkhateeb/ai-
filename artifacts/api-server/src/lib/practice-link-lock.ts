import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type PracticeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A single namespace lock gives a deterministic lock order for link, webhook,
// usage and recovery operations (including previously unknown memberships).
export async function lockPracticeLinks(tx: PracticeTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(1936876916, 1)`);
}