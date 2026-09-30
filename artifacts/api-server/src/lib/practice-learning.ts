import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  db,
  practiceAttemptsTable,
  practiceQuestionsTable,
} from "@workspace/db";
import type { PracticeTransaction } from "./practice-link-lock.js";

const DIFFICULTIES = ["Warm-up", "Core", "Stretch"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];
type PracticeAttempt = typeof practiceAttemptsTable.$inferSelect;
type PracticeQuestion = typeof practiceQuestionsTable.$inferSelect;

const RECENT_ATTEMPT_LIMIT = 100;
const HISTORY_DISPLAY_LIMIT = 12;
const SKILL_WINDOW = 5;

function normalizeDifficulty(value: string): Difficulty {
  return DIFFICULTIES.includes(value as Difficulty)
    ? (value as Difficulty)
    : DIFFICULTIES[0];
}

function nextDifficulty(attempts: PracticeAttempt[]): Difficulty {
  if (attempts.length === 0) return DIFFICULTIES[0];

  const latest = attempts[0];
  let streak = 0;
  for (const attempt of attempts) {
    if (attempt.correct !== latest.correct) break;
    streak += 1;
  }

  const currentIndex = DIFFICULTIES.indexOf(
    normalizeDifficulty(latest.difficulty),
  );
  const adjustment =
    streak >= 2 ? (latest.correct ? 1 : -1) : 0;
  const adjustedIndex = Math.max(
    0,
    Math.min(DIFFICULTIES.length - 1, currentIndex + adjustment),
  );
  return DIFFICULTIES[adjustedIndex];
}

type SkillProgress = {
  skill: string;
  recentAttempts: number;
  correctAttempts: number;
  accuracyPercent: number;
  nextDifficulty: Difficulty;
  lastAttemptAt: Date | null;
};

function buildSkillProgress(
  skills: string[],
  attempts: PracticeAttempt[],
): SkillProgress[] {
  return skills.map((skill) => {
    const bySkill = attempts.filter((attempt) => attempt.skill === skill);
    const recent = bySkill.slice(0, SKILL_WINDOW);
    const correctAttempts = recent.filter((attempt) => attempt.correct).length;
    return {
      skill,
      recentAttempts: recent.length,
      correctAttempts,
      accuracyPercent:
        recent.length === 0
          ? 0
          : Math.round((correctAttempts / recent.length) * 100),
      nextDifficulty: nextDifficulty(bySkill),
      lastAttemptAt: bySkill[0]?.createdAt ?? null,
    };
  });
}

function selectFocusSkill(progress: SkillProgress[]): SkillProgress {
  const struggling = progress
    .filter(
      (skill) => skill.recentAttempts >= 2 && skill.accuracyPercent < 70,
    )
    .sort(
      (a, b) =>
        a.accuracyPercent - b.accuracyPercent ||
        b.recentAttempts - a.recentAttempts ||
        a.skill.localeCompare(b.skill),
    )[0];
  if (struggling) return struggling;

  const newSkill = progress.find((skill) => skill.recentAttempts === 0);
  if (newSkill) return newSkill;

  return [...progress].sort((a, b) => {
    if (a.accuracyPercent !== b.accuracyPercent) {
      return a.accuracyPercent - b.accuracyPercent;
    }
    if (a.recentAttempts !== b.recentAttempts) {
      return a.recentAttempts - b.recentAttempts;
    }
    const aTime = a.lastAttemptAt?.getTime() ?? 0;
    const bTime = b.lastAttemptAt?.getTime() ?? 0;
    return aTime - bTime || a.skill.localeCompare(b.skill);
  })[0];
}

async function getLearnerAttempts(learnerId: string): Promise<PracticeAttempt[]> {
  return db
    .select()
    .from(practiceAttemptsTable)
    .where(eq(practiceAttemptsTable.learnerId, learnerId))
    .orderBy(desc(practiceAttemptsTable.createdAt), desc(practiceAttemptsTable.attemptId))
    .limit(RECENT_ATTEMPT_LIMIT);
}

async function getPracticeSkills(): Promise<string[]> {
  const questions = await db
    .select({ skill: practiceQuestionsTable.skill })
    .from(practiceQuestionsTable)
    .orderBy(practiceQuestionsTable.skill);
  return [...new Set(questions.map(({ skill }) => skill))];
}

export async function persistPracticeAttempt(
  tx: PracticeTransaction,
  learnerId: string,
  question: PracticeQuestion,
  answer: string,
  correct: boolean,
  feedback: string,
): Promise<void> {
  await tx.insert(practiceAttemptsTable).values({
    attemptId: randomUUID(),
    learnerId,
    questionId: question.id,
    prompt: question.prompt,
    skill: question.skill,
    difficulty: question.difficulty,
    answer,
    correctAnswer: question.correctOption,
    correct,
    feedback,
    pointsEarned: correct ? 25 : 5,
  });
}

export async function getPracticeRecommendation(
  learnerId: string,
  excludedQuestionIds: string[] = [],
) {
  const [attempts, skills, questions] = await Promise.all([
    getLearnerAttempts(learnerId),
    getPracticeSkills(),
    db.select().from(practiceQuestionsTable).orderBy(practiceQuestionsTable.id),
  ]);

  if (questions.length === 0 || skills.length === 0) {
    return null;
  }

  const progress = buildSkillProgress(skills, attempts);
  const focus = selectFocusSkill(progress);
  const skillQuestions = questions.filter(
    (question) => question.skill === focus.skill,
  );
  const excluded = new Set([
    ...excludedQuestionIds,
    ...attempts.slice(0, 3).map((attempt) => attempt.questionId),
  ]);
  const unusedQuestions = skillQuestions.filter(
    (question) => !excluded.has(question.id),
  );
  const candidates = unusedQuestions.length > 0 ? unusedQuestions : skillQuestions;
  const desiredLevel = DIFFICULTIES.indexOf(focus.nextDifficulty);
  const question = [...candidates].sort((a, b) => {
    const aDistance = Math.abs(
      DIFFICULTIES.indexOf(normalizeDifficulty(a.difficulty)) - desiredLevel,
    );
    const bDistance = Math.abs(
      DIFFICULTIES.indexOf(normalizeDifficulty(b.difficulty)) - desiredLevel,
    );
    return aDistance - bDistance || a.id.localeCompare(b.id);
  })[0];
  if (!question) return null;

  const reason =
    focus.recentAttempts === 0
      ? `A warm-up in ${focus.skill} will establish your starting level.`
      : focus.accuracyPercent < 70
        ? `Recent answers show that ${focus.skill} is worth practicing again.`
        : focus.nextDifficulty !== normalizeDifficulty(attempts.find(
              (attempt) => attempt.skill === focus.skill,
            )?.difficulty ?? focus.nextDifficulty)
          ? `Your recent answers are strong, so this question increases the challenge.`
          : `This keeps practice focused on ${focus.skill} at your current level.`;
  const { correctOption: _correctOption, ...publicQuestion } = question;

  return {
    question: publicQuestion,
    focusSkill: focus.skill,
    difficulty: question.difficulty,
    reason,
  };
}

export async function getPracticeHistory(learnerId: string) {
  const [attempts, skills] = await Promise.all([
    getLearnerAttempts(learnerId),
    getPracticeSkills(),
  ]);
  const skillProgress = buildSkillProgress(skills, attempts).map(
    ({ lastAttemptAt: _lastAttemptAt, ...progress }) => progress,
  );

  return {
    attempts: attempts.slice(0, HISTORY_DISPLAY_LIMIT),
    skillProgress,
  };
}