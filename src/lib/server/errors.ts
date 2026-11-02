export type ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid" | "conflict" | "locked";
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}
export const forbid = (msg = "You don't have access to this.") => new AppError("forbidden", msg);
export const notFound = (msg = "Not found.") => new AppError("not_found", msg);
export const invalid = (msg: string) => new AppError("invalid", msg);
export const conflict = (msg: string) => new AppError("conflict", msg);
