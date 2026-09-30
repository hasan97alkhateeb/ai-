import {
  getPracticeUsage,
  releasePracticeCoachingRequest,
  reservePracticeCoachingRequest,
} from "./practice-usage.js";
import { completePracticeCoachingRequest } from "./practice-reservations.js";
import type { PracticeTransaction } from "./practice-link-lock.js";

type PracticeLearner = Parameters<typeof reservePracticeCoachingRequest>[0];
type Reservation = NonNullable<
  Awaited<ReturnType<typeof reservePracticeCoachingRequest>>
>;
type Usage = Awaited<ReturnType<typeof getPracticeUsage>>;

export type PracticeCoachingRequestOutcome =
  | { status: 200; reservation: Reservation; feedback: string }
  | { status: 429; usage: Usage }
  | { status: 503; error: unknown; releaseError?: unknown };

/**
 * Reserves quota before calling the AI and returns usage if the reservation is
 * denied. Provider failures release the reservation for the same UTC period.
 */
export async function executePracticeCoachingRequest(
  learner: PracticeLearner,
  createFeedback: () => Promise<string>,
  now = new Date(),
  persistSuccessfulAttempt?: (
    tx: PracticeTransaction,
    feedback: string,
  ) => Promise<void>,
): Promise<PracticeCoachingRequestOutcome> {
  const reservation = await reservePracticeCoachingRequest(learner, now);

  if (!reservation) {
    return {
      status: 429,
      usage: await getPracticeUsage(learner, now),
    };
  }

  try {
    const feedback = (await createFeedback()).trim();
    if (!feedback) {
      throw new Error("The AI coach returned an empty response");
    }

    await completePracticeCoachingRequest(
      reservation.reservationId,
      persistSuccessfulAttempt
        ? (tx) => persistSuccessfulAttempt(tx, feedback)
        : undefined,
    );
    return { status: 200, reservation, feedback };
  } catch (error) {
    try {
      await releasePracticeCoachingRequest(
        reservation.reservationId,
      );
    } catch (releaseError) {
      return { status: 503, error, releaseError };
    }

    return { status: 503, error };
  }
}