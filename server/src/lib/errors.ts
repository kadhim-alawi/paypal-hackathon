export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "error",
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`, "not_found");
export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, "bad_request", details);
export const conflict = (message: string) => new HttpError(409, message, "conflict");
export const unauthorized = (message = "Authentication required") =>
  new HttpError(401, message, "unauthorized");
export const forbidden = (message = "Not allowed") => new HttpError(403, message, "forbidden");
