// The session doors' one refusal shape (routes/review.ts, routes/cv.ts): the response schema every
// refused status declares, and the body built from a module's own failure result.
import { z } from "zod";

export const Refusal = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const refusal = ({ code, message }: { code: string; message: string }) => ({ error: { code, message } });

/** An eligibility write's failure (answerEligibilityItem): an unknown item is 404, anything else the
 *  person sent is 400. */
export const answerStatus = (result: { status: number }): 404 | 400 => (result.status === 404 ? 404 : 400);
