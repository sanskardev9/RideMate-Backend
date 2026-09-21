import { isProduction } from "../config/env.js";

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
  static badRequest(detail) {
    return new ApiError(400, detail);
  }
  static unauthorized(detail = "Unauthorized") {
    return new ApiError(401, detail);
  }
  static forbidden(detail = "Forbidden") {
    return new ApiError(403, detail);
  }
  static notFound(detail = "Not found") {
    return new ApiError(404, detail);
  }
  static conflict(detail) {
    return new ApiError(409, detail);
  }
}

/** Forwards rejected promises from async route handlers to the error handler. */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export const notFound = (req, res) =>
  res.status(404).json({ detail: `No route for ${req.method} ${req.path}` });

const POSTGRES_STATUS = {
  "23505": [409, "That record already exists"],
  "23503": [400, "Referenced record does not exist"],
  "23514": [400, "Value failed a database constraint"],
  "22P02": [400, "Malformed identifier"],
};

// eslint-disable-next-line no-unused-vars -- Express needs all four parameters.
export function errorHandler(error, req, res, next) {
  if (error instanceof ApiError)
    return res.status(error.status).json({ detail: error.detail });

  const mapped = POSTGRES_STATUS[error?.code];
  if (mapped) return res.status(mapped[0]).json({ detail: mapped[1] });

  console.error(`[api] ${req.method} ${req.path}`, error);
  res.status(500).json({
    detail: "Server error",
    ...(isProduction ? {} : { message: error?.message }),
  });
}
