import app from "./app";
import { logger } from "./lib/logger";
import {
  COACHING_MAINTENANCE_PROBE_INTERVAL_MS,
  inspectPracticeCoachingMaintenance,
  prunePracticeCoachingReservations,
  reconcilePracticeCoachingReservations,
} from "./lib/practice-reservations";
import { getPracticeCoachingMaintenanceWarnings } from "./lib/practice-maintenance-monitor";

// Retrying from durable pending rows works after outages and process restarts.
let recovering = false;
// Durable success rows survive restarts; this is only the first-run fallback
// until each maintenance job has successfully written its initial timestamp.
const processStartedAt = Date.now();
let recoveryStartedAt: number | null = null;
async function recoverReservations() {
  if (recovering) return;
  recovering = true;
  recoveryStartedAt = Date.now();
  try {
    const recovered = await reconcilePracticeCoachingReservations();
    if (recovered) {
      logger.info(
        { recovered },
        "Restored expired coaching reservations",
      );
    }
  } catch (err) {
    logger.error({ err }, "Coaching reservation recovery failed; will retry");
  } finally {
    recovering = false;
    recoveryStartedAt = null;
  }
}
void recoverReservations();
setInterval(() => void recoverReservations(), 60_000).unref();

// Independent of recovery: one bounded batch per tick, no catch-up loop.
let pruning = false;
let retentionStartedAt: number | null = null;
async function pruneReservations() {
  if (pruning) return;
  pruning = true;
  retentionStartedAt = Date.now();
  try {
    const pruned = await prunePracticeCoachingReservations();
    if (pruned) {
      logger.info(
        { pruned },
        "Pruned old settled coaching reservations",
      );
    }
  } catch (err) {
    logger.error({ err }, "Coaching reservation retention failed; will retry");
  } finally {
    pruning = false;
    retentionStartedAt = null;
  }
}
void pruneReservations();
setInterval(() => void pruneReservations(), 60_000).unref();

// Monitoring is deliberately separate from learner requests and runs less
// often than the bounded maintenance jobs. Probes return capped backlog lower
// bounds, so even a large cleanup queue does not trigger an unbounded scan.
let monitoring = false;
async function monitorCoachingMaintenance() {
  if (monitoring) return;
  monitoring = true;
  try {
    const snapshot = await inspectPracticeCoachingMaintenance();
    const warnings = getPracticeCoachingMaintenanceWarnings(snapshot, {
      now: Date.now(),
      processStartedAt,
      recoveryStartedAt,
      retentionStartedAt,
    });
    for (const warning of warnings) {
      logger.warn({
        check: warning.check,
        reasons: warning.reasons,
        ...warning.fields,
      }, warning.message);
    }
  } catch (err) {
    logger.error({ err }, "Coaching maintenance monitoring probe failed");
  } finally {
    monitoring = false;
  }
}
void monitorCoachingMaintenance();
setInterval(() => void monitorCoachingMaintenance(), COACHING_MAINTENANCE_PROBE_INTERVAL_MS).unref();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
