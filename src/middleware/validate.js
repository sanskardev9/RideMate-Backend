import { ApiError } from "./errors.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERIC_ID = /^[1-9][0-9]{0,18}$/;

export function requiredString(value, field, { min = 1, max = 255 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min)
    throw ApiError.badRequest(
      min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`,
    );
  if (text.length > max)
    throw ApiError.badRequest(`${field} must be at most ${max} characters`);
  return text;
}

export function requiredEmail(value, field = "Email") {
  const email = requiredString(value, field).toLowerCase();
  if (!EMAIL.test(email)) throw ApiError.badRequest(`${field} is not a valid address`);
  return email;
}

/**
 * Database ids are bigint. node-postgres returns them as strings to avoid
 * precision loss, so ids are normalised to strings everywhere in the API.
 */
export function requiredId(value, field) {
  const id = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!NUMERIC_ID.test(id) || !Number.isSafeInteger(Number(id)))
    throw ApiError.badRequest(`${field} is not a valid id`);
  return id;
}

export function requiredCoordinate(value, field, limit) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit)
    throw ApiError.badRequest(`${field} must be a number between -${limit} and ${limit}`);
  return number;
}

export const requiredLatitude = (value) => requiredCoordinate(value, "Latitude", 90);
export const requiredLongitude = (value) => requiredCoordinate(value, "Longitude", 180);

export function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function boundedLimit(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(Math.floor(number), max);
}

/** Rejects a malformed :id early so Postgres never sees an invalid bigint. */
export const validateIdParam =
  (param = "id") =>
  (req, _res, next) => {
    try {
      req.params[param] = requiredId(req.params[param], "Identifier");
      next();
    } catch (error) {
      next(error);
    }
  };
