import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const progressTable = pgTable(
  "lesson_progress",
  {
    courseId: text("course_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    completed: boolean("completed").notNull().default(false),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.courseId, table.lessonId] }),
  }),
);

export const insertProgressSchema = createInsertSchema(progressTable);
export type InsertProgress = z.infer<typeof insertProgressSchema>;
export type Progress = typeof progressTable.$inferSelect;