import { and, asc, eq } from "drizzle-orm";
import {
  coursesTable,
  db,
  lessonsTable,
  progressTable,
  type Course as DbCourse,
  type Lesson as DbLesson,
} from "@workspace/db";

export async function getCourses() {
  return db.select().from(coursesTable);
}

export async function getLessonsForCourse(courseId: string) {
  return db
    .select()
    .from(lessonsTable)
    .where(eq(lessonsTable.courseId, courseId))
    .orderBy(asc(lessonsTable.order));
}

export async function getProgress() {
  return db.select().from(progressTable);
}

export function courseWithProgress(
  course: DbCourse,
  progress: { courseId: string; lessonId: string; completed: boolean }[],
) {
  const completedLessons = progress.filter(
    (item) => item.courseId === course.id && item.completed,
  ).length;

  return {
    ...course,
    completedLessons,
    progressPercent:
      course.lessonCount === 0
        ? 0
        : Math.round((completedLessons / course.lessonCount) * 100),
  };
}

export function lessonWithProgress(
  lesson: DbLesson,
  progress: { courseId: string; lessonId: string; completed: boolean }[],
) {
  return {
    ...lesson,
    completed: progress.some(
      (item) =>
        item.courseId === lesson.courseId &&
        item.lessonId === lesson.id &&
        item.completed,
    ),
  };
}

export async function getCourseById(courseId: string) {
  const [course] = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, courseId));
  return course;
}

export async function getLessonForCourse(courseId: string, lessonId: string) {
  const [lesson] = await db
    .select()
    .from(lessonsTable)
    .where(and(eq(lessonsTable.courseId, courseId), eq(lessonsTable.id, lessonId)));
  return lesson;
}