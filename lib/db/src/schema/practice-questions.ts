import { createInsertSchema } from "drizzle-zod";
import { pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const practiceQuestionsTable = pgTable("practice_questions", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  context: text("context").notNull(),
  options: text("options").array().notNull(),
  correctOption: text("correct_option").notNull(),
  skill: text("skill").notNull(),
  difficulty: text("difficulty").notNull(),
});

export const insertPracticeQuestionSchema = createInsertSchema(
  practiceQuestionsTable,
);
export type InsertPracticeQuestion = z.infer<
  typeof insertPracticeQuestionSchema
>;
export type PracticeQuestion = typeof practiceQuestionsTable.$inferSelect;