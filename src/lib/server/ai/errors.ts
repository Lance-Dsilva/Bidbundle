import "server-only";

/**
 * Raised by a tool or the chat route for a caller-facing failure (bad input,
 * missing record, out-of-scope access). Distinct from an unexpected
 * exception, which the route maps to a generic 500 instead of leaking detail.
 */
export class AiToolError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AiToolError";
    this.status = status;
  }
}
