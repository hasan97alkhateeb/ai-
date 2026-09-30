import {
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const coachingPlanEnum = pgEnum("coaching_plan", ["free", "pro"]);

export const practiceLinkConflictsTable = pgTable("practice_link_conflicts", {
  conflictId: text("conflict_id").primaryKey(),
  authUserId: text("auth_user_id").notNull(),
  canonicalLearnerId: text("canonical_learner_id").notNull(),
  anonymousLearnerId: text("anonymous_learner_id").notNull(),
  accountMembershipId: text("account_membership_id").notNull(),
  anonymousMembershipId: text("anonymous_membership_id").notNull(),
  status: text("status").notNull().default("pending"),
  retainedMembershipId: text("retained_membership_id"),
  evidence: jsonb("evidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => ({
  pairUnique: uniqueIndex("practice_link_conflict_pair").on(table.canonicalLearnerId, table.anonymousLearnerId),
}));

export const practiceLinkAuditTable = pgTable("practice_link_audit", {
  auditId: text("audit_id").primaryKey(),
  conflictId: text("conflict_id").notNull(),
  operator: text("operator").notNull(),
  action: text("action").notNull(),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Tombstones retain history and route in-flight reservations/releases safely.
export const practiceLearnerAliasesTable = pgTable("practice_learner_aliases", {
  learnerId: text("learner_id").primaryKey(),
  canonicalLearnerId: text("canonical_learner_id").notNull(),
});

export const practiceRetiredMembershipsTable = pgTable("practice_retired_memberships", {
  membershipId: text("membership_id").primaryKey(),
  conflictId: text("conflict_id").notNull(),
  canonicalLearnerId: text("canonical_learner_id").notNull(),
});

export const practiceLearnersTable = pgTable("practice_learners", {
  learnerId: text("learner_id").primaryKey(),
  authUserId: text("auth_user_id"),
  plan: coachingPlanEnum("plan").notNull().default("free"),
  whopMembershipId: text("whop_membership_id"),
  whopCheckoutConfigurationId: text("whop_checkout_configuration_id"),
  whopPlanId: text("whop_plan_id"),
  whopStatus: text("whop_status"),
  whopCurrentPeriodEnd: timestamp("whop_current_period_end", {
    withTimezone: true,
  }),
  whopManageUrl: text("whop_manage_url"),
  whopRecoveryUrl: text("whop_recovery_url"),
  whopLastEventAt: timestamp("whop_last_event_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  authUserUnique: uniqueIndex("practice_learners_auth_user_unique")
    .on(table.authUserId),
  whopMembershipUnique: uniqueIndex("practice_learners_whop_membership_unique")
    .on(table.whopMembershipId),
}));

export const practiceCoachingUsageTable = pgTable(
  "practice_coaching_usage",
  {
    learnerId: text("learner_id")
      .notNull()
      .references(() => practiceLearnersTable.learnerId, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.learnerId, table.periodKey] }),
  }),
);

export const practiceCoachingReservationsTable = pgTable(
  "practice_coaching_reservations",
  {
    reservationId: text("reservation_id").primaryKey(),
    learnerId: text("learner_id").notNull()
      .references(() => practiceLearnersTable.learnerId, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    status: text("status", { enum: ["pending", "succeeded", "released"] }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Default gives legacy rows a full retention window on migration.
    // Pending rows are never eligible; every settlement resets this timestamp.
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recoveryIndex: index("practice_coaching_reservations_recovery").on(table.status, table.expiresAt),
    retentionIndex: index("practice_coaching_reservations_retention").on(table.status, table.settledAt, table.reservationId),
  }),
);

export const practiceCoachingMaintenanceTable = pgTable(
  "practice_coaching_maintenance",
  {
    job: text("job", {
      enum: ["reservation-recovery", "reservation-retention"],
    }).primaryKey(),
    lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true })
      .notNull(),
  },
);

export const practiceCheckoutSessionsTable = pgTable(
  "practice_checkout_sessions",
  {
    checkoutConfigurationId: text("checkout_configuration_id").primaryKey(),
    learnerId: text("learner_id")
      .notNull()
      .references(() => practiceLearnersTable.learnerId, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const practiceWhopWebhookEventsTable = pgTable(
  "practice_whop_webhook_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);