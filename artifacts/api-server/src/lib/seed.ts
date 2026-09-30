import { db } from "@workspace/db";
import {
  activityTable,
  coursesTable,
  lessonsTable,
  practiceQuestionsTable,
  progressTable,
} from "@workspace/db";

const courses = [
  {
    id: "ai-foundations",
    title: "AI Foundations",
    subtitle: "Think clearly about AI",
    description:
      "Build a durable mental model for how modern AI works, where it helps, and where human judgment still matters.",
    level: "Beginner",
    category: "Foundations",
    durationMinutes: 95,
    lessonCount: 5,
    accent: "violet",
    icon: "sparkles",
    tags: ["AI basics", "Critical thinking"],
  },
  {
    id: "prompt-craft",
    title: "Prompt Craft",
    subtitle: "Get better outputs, faster",
    description:
      "Learn a repeatable way to frame problems, guide models, and refine prompts until the output is ready to use.",
    level: "Beginner",
    category: "Practical skills",
    durationMinutes: 140,
    lessonCount: 6,
    accent: "coral",
    icon: "wand",
    tags: ["Prompting", "Workflows"],
  },
  {
    id: "ai-workflows",
    title: "AI Workflows",
    subtitle: "Turn one-off wins into systems",
    description:
      "Design reliable AI-assisted workflows that save time without adding hidden complexity to your day.",
    level: "Intermediate",
    category: "Applied AI",
    durationMinutes: 180,
    lessonCount: 7,
    accent: "teal",
    icon: "route",
    tags: ["Automation", "Systems"],
  },
];

const lessons = [
  {
    id: "foundations-mental-model",
    courseId: "ai-foundations",
    title: "A useful mental model for AI",
    description: "See what a model is actually doing when it generates an answer.",
    durationMinutes: 14,
    type: "Lesson",
    order: 1,
  },
  {
    id: "foundations-capabilities",
    courseId: "ai-foundations",
    title: "Capabilities, limits, and judgment",
    description: "Know when to trust the output and when to slow down.",
    durationMinutes: 18,
    type: "Lesson",
    order: 2,
  },
  {
    id: "foundations-language",
    courseId: "ai-foundations",
    title: "Why language changes the result",
    description: "Understand how context and intent shape an answer.",
    durationMinutes: 16,
    type: "Lesson",
    order: 3,
  },
  {
    id: "foundations-evaluation",
    courseId: "ai-foundations",
    title: "Evaluating an AI response",
    description: "Use a simple checklist to review accuracy and usefulness.",
    durationMinutes: 22,
    type: "Practice",
    order: 4,
  },
  {
    id: "foundations-next",
    courseId: "ai-foundations",
    title: "Your AI learning loop",
    description: "Create a small habit that compounds over time.",
    durationMinutes: 25,
    type: "Reflection",
    order: 5,
  },
  {
    id: "prompt-brief",
    courseId: "prompt-craft",
    title: "Start with the outcome",
    description: "Write prompts that name the work, not just the topic.",
    durationMinutes: 20,
    type: "Lesson",
    order: 1,
  },
  {
    id: "prompt-context",
    courseId: "prompt-craft",
    title: "Give the right context",
    description: "Add the details a capable teammate would need.",
    durationMinutes: 24,
    type: "Lesson",
    order: 2,
  },
  {
    id: "prompt-constraints",
    courseId: "prompt-craft",
    title: "Use constraints as a creative tool",
    description: "Guide length, tone, format, and boundaries with confidence.",
    durationMinutes: 26,
    type: "Practice",
    order: 3,
  },
  {
    id: "prompt-iterate",
    courseId: "prompt-craft",
    title: "Iterate without starting over",
    description: "Build on a strong first draft instead of rewriting blindly.",
    durationMinutes: 22,
    type: "Lesson",
    order: 4,
  },
  {
    id: "prompt-quality",
    courseId: "prompt-craft",
    title: "A quality check for prompts",
    description: "Spot ambiguity before it costs you time.",
    durationMinutes: 20,
    type: "Practice",
    order: 5,
  },
  {
    id: "prompt-library",
    courseId: "prompt-craft",
    title: "Build your personal library",
    description: "Keep the prompts that make your work meaningfully better.",
    durationMinutes: 28,
    type: "Project",
    order: 6,
  },
  {
    id: "workflow-map",
    courseId: "ai-workflows",
    title: "Map the work before the tools",
    description: "Find the moments where AI can reduce friction.",
    durationMinutes: 28,
    type: "Lesson",
    order: 1,
  },
  {
    id: "workflow-handoffs",
    courseId: "ai-workflows",
    title: "Design clean handoffs",
    description: "Make human and AI responsibilities obvious.",
    durationMinutes: 26,
    type: "Lesson",
    order: 2,
  },
  {
    id: "workflow-checks",
    courseId: "ai-workflows",
    title: "Add lightweight quality checks",
    description: "Catch mistakes without turning the process into a maze.",
    durationMinutes: 30,
    type: "Practice",
    order: 3,
  },
];

const activity = [
  {
    title: "Completed A useful mental model for AI",
    description: "AI Foundations · 14 min",
    type: "lesson-completed",
    courseId: "ai-foundations",
    createdAt: new Date("2026-09-26T08:20:00.000Z"),
  },
  {
    title: "Reached a 4 day learning streak",
    description: "Small steps add up. Keep going.",
    type: "streak",
    courseId: null,
    createdAt: new Date("2026-09-25T17:10:00.000Z"),
  },
  {
    title: "Started Prompt Craft",
    description: "Prompt Craft · 20 min",
    type: "course-started",
    courseId: "prompt-craft",
    createdAt: new Date("2026-09-24T12:40:00.000Z"),
  },
  {
    title: "Earned the Clear Thinker badge",
    description: "Finished 3 practice activities",
    type: "achievement",
    courseId: null,
    createdAt: new Date("2026-09-22T15:00:00.000Z"),
  },
];

const practiceQuestions = [
  {
    id: "practice-brief",
    prompt: "Which prompt gives an AI assistant the clearest direction?",
    context:
      "You want a concise summary of a long customer interview for a product team.",
    options: [
      "Summarize this.",
      "Write a short summary of this interview.",
      "Summarize the interview in 5 bullets, focusing on unmet needs and quoting the customer when useful.",
      "Make this better for my team.",
    ],
    correctOption:
      "Summarize the interview in 5 bullets, focusing on unmet needs and quoting the customer when useful.",
    skill: "Prompt clarity",
    difficulty: "Warm-up",
  },
  {
    id: "practice-review",
    prompt: "What is the best first step when an AI answer feels too confident?",
    context: "The response contains a specific claim you cannot verify yet.",
    options: [
      "Share it because the language sounds certain.",
      "Ask the model to explain how it knows and verify the claim independently.",
      "Delete the response and start with a different model.",
      "Add more adjectives to the prompt.",
    ],
    correctOption:
      "Ask the model to explain how it knows and verify the claim independently.",
    skill: "Critical thinking",
    difficulty: "Core",
  },
  {
    id: "practice-workflow",
    prompt: "Where does AI usually create the most reliable leverage in a workflow?",
    context: "You are improving a recurring weekly reporting process.",
    options: [
      "At every step, without human review.",
      "In a well-defined step with clear inputs, outputs, and a quick quality check.",
      "Only at the very end after all decisions are made.",
      "By replacing the process with a single large prompt.",
    ],
    correctOption:
      "In a well-defined step with clear inputs, outputs, and a quick quality check.",
    skill: "Workflow design",
    difficulty: "Stretch",
  },
  {
    id: "practice-brief-core",
    prompt: "Which prompt is most likely to produce a useful project update?",
    context: "You have meeting notes and need to brief a busy project lead.",
    options: [
      "Tell me what happened in this meeting.",
      "Turn these notes into a project update with decisions, owners, deadlines, and open questions. Use only details in the notes.",
      "Write a polished update that makes the project sound successful.",
      "Summarize everything in the notes without leaving anything out.",
    ],
    correctOption:
      "Turn these notes into a project update with decisions, owners, deadlines, and open questions. Use only details in the notes.",
    skill: "Prompt clarity",
    difficulty: "Core",
  },
  {
    id: "practice-brief-stretch",
    prompt: "How should you ask an AI to draft a response when the source material is incomplete?",
    context: "A customer asks why a delivery was delayed, but the records do not show the cause.",
    options: [
      "Give a confident explanation based on the most likely cause.",
      "Apologize, state only confirmed details, mark what is unknown, and ask for the missing information before promising a resolution.",
      "Avoid mentioning the missing records so the response feels complete.",
      "Ask the model to invent a reasonable explanation and make it sound empathetic.",
    ],
    correctOption:
      "Apologize, state only confirmed details, mark what is unknown, and ask for the missing information before promising a resolution.",
    skill: "Prompt clarity",
    difficulty: "Stretch",
  },
  {
    id: "practice-review-warmup",
    prompt: "What should you do with an AI summary before sharing it?",
    context: "The summary sounds clear, but you have the original source available.",
    options: [
      "Check that its important claims match the source.",
      "Share it because clear writing is a sign of accuracy.",
      "Ask the same model to say whether it is correct.",
      "Remove details that seem unusual without checking them.",
    ],
    correctOption: "Check that its important claims match the source.",
    skill: "Critical thinking",
    difficulty: "Warm-up",
  },
  {
    id: "practice-review-stretch",
    prompt: "An AI response gives precise citations to a policy you have not checked. What is the best next step?",
    context: "The answer could affect an employee's eligibility for a benefit.",
    options: [
      "Rely on the citations because they look specific.",
      "Verify the cited policy and wording in the authoritative source, then check that it applies to this case.",
      "Ask the AI to repeat the citations more confidently.",
      "Use the answer but remove the citations.",
    ],
    correctOption:
      "Verify the cited policy and wording in the authoritative source, then check that it applies to this case.",
    skill: "Critical thinking",
    difficulty: "Stretch",
  },
  {
    id: "practice-workflow-warmup",
    prompt: "Where is a sensible first place to try AI in a recurring task?",
    context: "Your team spends time turning rough notes into a first draft for review.",
    options: [
      "Let AI publish the finished work without anyone checking it.",
      "Use AI to create a draft, then have a person review it before it is shared.",
      "Replace the whole process before testing a small change.",
      "Use AI only after the team has made every decision.",
    ],
    correctOption:
      "Use AI to create a draft, then have a person review it before it is shared.",
    skill: "Workflow design",
    difficulty: "Warm-up",
  },
  {
    id: "practice-workflow-core",
    prompt: "How should you design an AI-assisted intake workflow for requests with different risk levels?",
    context: "Some requests are routine, while others need specialist approval.",
    options: [
      "Give AI authority to approve every request so the queue moves faster.",
      "Define clear inputs and low-risk cases for AI support, route exceptions to a person, and log decisions for review.",
      "Ask AI to handle the requests and let people review only if someone complains.",
      "Use one prompt for every case and do not track its results.",
    ],
    correctOption:
      "Define clear inputs and low-risk cases for AI support, route exceptions to a person, and log decisions for review.",
    skill: "Workflow design",
    difficulty: "Core",
  },
];

let seedPromise: Promise<void> | undefined;

export function ensureSeedData(): Promise<void> {
  seedPromise ??= (async () => {
    const existingCourses = await db
      .select({ id: coursesTable.id })
      .from(coursesTable)
      .limit(1);
    if (existingCourses.length === 0) {
      await db.insert(coursesTable).values(courses);
      await db.insert(lessonsTable).values(lessons);
      await db.insert(progressTable).values([
        {
          courseId: "ai-foundations",
          lessonId: "foundations-mental-model",
          completed: true,
        },
        {
          courseId: "ai-foundations",
          lessonId: "foundations-capabilities",
          completed: true,
        },
        {
          courseId: "prompt-craft",
          lessonId: "prompt-brief",
          completed: true,
        },
      ]);
    }

    const existingActivity = await db
      .select({ id: activityTable.id })
      .from(activityTable)
      .limit(1);
    if (existingActivity.length === 0) {
      await db.insert(activityTable).values(activity);
    }

    await db
      .insert(practiceQuestionsTable)
      .values(practiceQuestions)
      .onConflictDoNothing();
  })();

  return seedPromise;
}