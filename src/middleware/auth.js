import { verifyToken } from "../services/auth.service.js";
import { isMember } from "../services/groups.service.js";
import { findRide } from "../services/rides.service.js";
import { ApiError, asyncHandler } from "./errors.js";

const bearer = (req) => {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
};

/** Populates req.rider from the bearer token, or rejects with 401. */
export function requireAuth(req, _res, next) {
  const token = bearer(req);
  if (!token) return next(ApiError.unauthorized("Authorization token missing"));
  try {
    const claims = verifyToken(token);
    req.rider = { id: claims.sub, name: claims.name, email: claims.email };
    next();
  } catch {
    next(ApiError.unauthorized("Session expired, please sign in again"));
  }
}

/**
 * Guards group-scoped routes. Without this, any signed-in rider could read
 * another group's chat and live locations.
 */
export const requireGroupMembership = (param = "id") =>
  asyncHandler(async (req, _res, next) => {
    const groupId = req.params[param];
    if (!(await isMember(groupId, req.rider.id)))
      throw ApiError.forbidden("You are not a member of this group");
    req.groupId = groupId;
    next();
  });

/** Same guard for ride-scoped routes, resolved through the ride's group. */
export const requireRideMembership = (param = "id") =>
  asyncHandler(async (req, _res, next) => {
    const ride = await findRide(req.params[param]);
    if (!ride) throw ApiError.notFound("Ride not found");
    if (!(await isMember(ride.group_id, req.rider.id)))
      throw ApiError.forbidden("You are not a member of this ride's group");
    req.ride = ride;
    next();
  });
