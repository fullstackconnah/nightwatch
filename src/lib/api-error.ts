export class ApiError extends Error {
  status: number;
  /** Set only by the system route's step-up refusals ("missing" | "wrong" | "limited"). */
  stepUp?: string;
  constructor(message: string, status: number, stepUp?: string) {
    super(message);
    this.status = status;
    this.stepUp = stepUp;
  }
}

/** True for the route's own current-password refusal; a middleware 403 or a field 400 has no tag. */
export function isStepUpRefusal(e: unknown): e is ApiError & { stepUp: string } {
  return e instanceof ApiError && typeof e.stepUp === "string";
}

/** The error text the server sent, or null for an offline/timeout failure or a bare "HTTP 500" (nothing worth showing). */
export function serverMessage(e: unknown): string | null {
  return e instanceof ApiError && !/^HTTP \d+$/.test(e.message) ? e.message : null;
}
