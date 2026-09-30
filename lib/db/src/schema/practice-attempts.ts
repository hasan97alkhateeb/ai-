import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { practiceLearnersTable } from "./practice-coaching";

export const practiceAttemptsTable = pgTable(
  "practice_attempts",
  {
    attemptId: text("attempt_id").primaryKey(),
    learnerId: text("learner_id")
      .notNull()
      .references(() => practiceLearnersTable.learnerId, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    prompt: text("prompt").notNull(),
    skill: text("skill").notNull(),
    difficulty: text("difficulty").notNull(),
    answer: text("answer").notNull(),
    correctAnswer: text("correct_answer").notNull(),
    correct: boolean("correct").notNull(),
    feedback: text("feedback").notNull(),
    pointsEarned: integer("points_earned").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    learnerHistory: index("practice_attempts_learner_created")
      .on(table.learnerId, table.createdAt),
  }),
);