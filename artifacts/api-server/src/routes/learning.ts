import { Router, type IRouter } from "express";
import {
  GetCourseParams,
  GetCourseResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
  UpdateCourseProgressBody,
  UpdateCourseProgressParams,
  UpdateCourseProgressResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { progressTable } from "@workspace/db";
import { ensureSeedData } from "../lib/seed";
import {
  courseWithProgress,
  getCourseById,
  getCourses,
  getLessonForCourse,
  getLessonsForCourse,
  getProgress,
  lessonWithProgress,
} from "../lib/learning";

const router: IRouter = Router();

router.get("/courses", async (req, res): Promise<void> => {
  await ensureSeedData();
  const query = ListCoursesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const [courses, progress] = await Promise.all([getCourses(), getProgress()]);
  const filtered = courses.filter((course) => {
    const categoryMatches =
      query.data.category == null || course.category === query.data.category;
    const levelMatches =
      query.data.level == null || course.level === query.data.level;
    return categoryMatches && levelMatches;
  });

  res.json(
    ListCoursesResponse.parse(
      filtered.map((course) => courseWithProgress(course, progress)),
    ),
  );
});

router.get("/courses/:courseId", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const course = await getCourseById(params.data.courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const [lessons, progress] = await Promise.all([
    getLessonsForCourse(course.id),
    getProgress(),
  ]);
  res.json(
    GetCourseResponse.parse({
      ...courseWithProgress(course, progress),
      lessons: lessons.map((lesson) => lessonWithProgress(lesson, progress)),
    }),
  );
});

router.post("/courses/:courseId/progress", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = UpdateCourseProgressParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateCourseProgressBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [course, lesson] = await Promise.all([
    getCourseById(params.data.courseId),
    getLessonForCourse(params.data.courseId, body.data.lessonId),
  ]);
  if (!course || !lesson) {
    res.status(404).json({ error: "Course or lesson not found" });
    return;
  }

  await db
    .insert(progressTable)
    .values({
      courseId: params.data.courseId,
      lessonId: body.data.lessonId,
      completed: body.data.completed,
    })
    .onConflictDoUpdate({
      target: [progressTable.courseId, progressTable.lessonId],
      set: { completed: body.data.completed },
    });

  const progress = await getProgress();
  res.json(
    UpdateCourseProgressResponse.parse({
      courseId: course.id,
      completedLessons: progress.filter(
        (item) => item.courseId === course.id && item.completed,
      ).length,
      lessonCount: course.lessonCount,
      progressPercent: course.lessonCount
        ? Math.round(
            (progress.filter(
              (item) => item.courseId === course.id && item.completed,
            ).length /
              course.lessonCount) *
              100,
          )
        : 0,
    }),
  );
});

export default router;