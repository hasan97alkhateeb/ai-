import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const lessonsTable = pgTable("lessons", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  type: text("type").notNull(),
  order: integer("order").notNull(),
});

export const insertLessonSchema = createInsertSchema(lessonsTable);
export type InsertLesson = z.infer<typeof insertLessonSchema>;
export type Lesson = typeof lessonsTable.$inferSelect;