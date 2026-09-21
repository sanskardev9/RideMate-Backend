import { Router } from "express";
import { requireAuth, requireGroupMembership } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";
import { boundedLimit, validateIdParam } from "../middleware/validate.js";
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
    res.json(await rides.listForGroup(req.groupId, boundedLimit(req.query.limit, 20, 100))),
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
