import { mock } from "node:test";
import type { Request } from "express";

// Test-bundle replacements, never imported by the running application.
// Simulate the identity supplied by Clerk, not Clerk's token verification.
export function getAuth(req: Request) {
  return { userId: req.get("x-test-auth-user") ?? null };
}

export const createFeedback = mock.fn(async () => {
  throw new Error("A capped request must not reach the AI provider");
});

export const openai = {
  chat: { completions: { create: createFeedback } },
};

// Tests insert their own question rather than seed shared application data.
export async function ensureSeedData(): Promise<void> {}
