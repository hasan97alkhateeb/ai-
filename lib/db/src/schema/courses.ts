import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const coursesTable = pgTable("courses", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  description: text("description").notNull(),
  level: text("level").notNull(),
  category: text("category").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  lessonCount: integer("lesson_count").notNull(),
  accent: text("accent").notNull(),
  icon: text("icon").notNull(),
  tags: text("tags").array().notNull(),
});

export const insertCourseSchema = createInsertSchema(coursesTable);
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof coursesTable.$inferSelect;