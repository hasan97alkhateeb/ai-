import { desc } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  ListActivityResponse,
} from "@workspace/api-zod";
import { activityTable, db } from "@workspace/db";
import { ensureSeedData } from "../lib/seed";
import {
  courseWithProgress,
  getCourses,
  getProgress,
} from "../lib/learning";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const [courses, progress] = await Promise.all([getCourses(), getProgress()]);
  const completedLessons = progress.filter((item) => item.completed).length;
  const inProgress = courses
    .map((course) => courseWithProgress(course, progress))
    .filter((course) => course.progressPercent > 0 && course.progressPercent < 100);

  res.json(
    GetDashboardResponse.parse({
      learner: {
        name: "Alex Morgan",
        role: "Product designer",
        level: "Curious builder",
        xp: 640,
        streakDays: 4,
      },
      stats: {
        weeklyMinutes: 135,
        completedLessons,
        totalLessons: courses.reduce((total, course) => total + course.lessonCount, 0),
        completionPercent: courses.length
          ? Math.round(
              (completedLessons /
                courses.reduce((total, course) => total + course.lessonCount, 0)) *
                100,
            )
          : 0,
      },
      inProgress,
      recommendedCourseId: "ai-workflows",
    }),
  );
});

router.get("/activity", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const activity = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(8);
  res.json(
    ListActivityResponse.parse(
      activity.map((item) => ({ ...item, id: String(item.id) })),
    ),
  );
});

export default router;