export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** The error text the server sent, or null for an offline/timeout failure or a bare "HTTP 500" (nothing worth showing). */
export function serverMessage(e: unknown): string | null {
  return e instanceof ApiError && !/^HTTP \d+$/.test(e.message) ? e.message : null;
}
