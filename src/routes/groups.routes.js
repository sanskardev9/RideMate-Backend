import { Router } from "express";
import { requireAuth, requireGroupMembership } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";
import {
  boundedLimit,
  requiredLatitude,
  requiredLongitude,
  validateIdParam,
} from "../middleware/validate.js";
import * as groups from "../services/groups.service.js";
import * as messages from "../services/messages.service.js";
import * as locations from "../services/locations.service.js";
import * as rides from "../services/rides.service.js";
import * as sos from "../services/sos.service.js";
import { broadcastToGroup } from "../realtime/hub.js";

export const groupRoutes = Router();

groupRoutes.use(requireAuth);

groupRoutes.get(
  "/",
  asyncHandler(async (req, res) => res.json(await groups.listForRider(req.rider.id))),
);

groupRoutes.post(
  "/",
  asyncHandler(async (req, res) =>
    res.status(201).json(await groups.create(req.body, req.rider.id)),
  ),
);

groupRoutes.post(
  "/join",
  asyncHandler(async (req, res) => res.json(await groups.joinByCode(req.body, req.rider.id))),
);

// Every route below is scoped to a group the caller belongs to.
const member = [validateIdParam("id"), requireGroupMembership("id")];

groupRoutes.get(
  "/:id",
  member,
  asyncHandler(async (req, res) => res.json(await groups.findForRider(req.groupId, req.rider.id))),
);

groupRoutes.delete(
  "/:id/members/me",
  member,
  asyncHandler(async (req, res) => {
    await groups.leave(req.groupId, req.rider.id);
    broadcastToGroup(req.groupId, { type: "member_left", groupId: req.groupId, userId: req.rider.id });
    res.status(204).end();
  }),
);

groupRoutes.get(
  "/:id/members",
  member,
  asyncHandler(async (req, res) => res.json(await groups.listMembers(req.groupId))),
);

groupRoutes.get(
  "/:id/locations",
  member,
  asyncHandler(async (req, res) => res.json(await locations.listForGroup(req.groupId))),
);

/**
 * REST fallback for `location_update`. A phone that has been put in the
 * background usually loses its websocket long before it loses data, so the
 * app keeps posting positions this way while it reconnects.
 */
groupRoutes.post(
  "/:id/locations",
  member,
  asyncHandler(async (req, res) => {
    const latitude = requiredLatitude(req.body?.latitude);
    const longitude = requiredLongitude(req.body?.longitude);
    const accuracy = Number.isFinite(Number(req.body?.accuracy))
      ? Number(req.body.accuracy)
      : null;
    // As on the socket: the server decides whether this rider is on a ride,
    // and off a ride the position is neither stored nor shared.
    const rideId = await rides.activeParticipation(req.groupId, req.rider.id);
    if (!rideId) return res.status(202).json({ shared: false });

    const saved = await locations.record({
      riderId: req.rider.id,
      groupId: req.groupId,
      rideId,
      latitude,
      longitude,
      accuracy,
    });
    broadcastToGroup(req.groupId, {
      type: "location_update",
      groupId: req.groupId,
      rideId: saved.ride_id,
      userId: req.rider.id,
      name: req.rider.name,
      latitude: saved.latitude,
      longitude: saved.longitude,
      accuracy: saved.accuracy,
      timestamp: saved.updated_at,
      online: true,
    });
    res.json({ shared: true });
  }),
);

groupRoutes.get(
  "/:id/messages",
  member,
  asyncHandler(async (req, res) =>
    res.json(
      await messages.list(req.groupId, { limit: req.query.limit, before: req.query.before }),
    ),
  ),
);

// REST fallback for sending chat when the websocket is not connected.
groupRoutes.post(
  "/:id/messages",
  member,
  asyncHandler(async (req, res) => {
    const message = await messages.create(req.groupId, req.rider.id, req.body);
    broadcastToGroup(req.groupId, { type: "chat_message", ...message, status: "sent" });
    res.status(201).json(message);
  }),
);

groupRoutes.get(
  "/:id/rides",
  member,
  asyncHandler(async (req, res) =>
    res.json(
      await rides.listForGroup(
        req.groupId,
        boundedLimit(req.query.limit, 20, 100),
        req.rider.id,
      ),
    ),
  ),
);

groupRoutes.post(
  "/:id/rides",
  member,
  asyncHandler(async (req, res) => {
    const ride = await rides.start(req.groupId, req.rider.id);
    broadcastToGroup(req.groupId, {
      type: "ride_started",
      groupId: req.groupId,
      rideId: ride.id,
      startedAt: ride.started_at,
    });
    res.status(201).json(ride);
  }),
);

groupRoutes.get(
  "/:id/sos",
  member,
  asyncHandler(async (req, res) => res.json(await sos.listActive(req.groupId))),
);
