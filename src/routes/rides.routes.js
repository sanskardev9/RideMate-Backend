import { Router } from "express";
import { requireAuth, requireRideMembership } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";
import { validateIdParam } from "../middleware/validate.js";
import * as rides from "../services/rides.service.js";
import { broadcastToGroup } from "../realtime/hub.js";

export const rideRoutes = Router();

rideRoutes.use(requireAuth);

const participant = [validateIdParam("id"), requireRideMembership("id")];

rideRoutes.get(
  "/:id",
  participant,
  asyncHandler(async (req, res) => res.json(await rides.detail(req.ride.id, req.rider.id))),
);

rideRoutes.get(
  "/:id/participants",
  participant,
  asyncHandler(async (req, res) => res.json(await rides.participants(req.ride.id))),
);

rideRoutes.post(
  "/:id/join",
  participant,
  asyncHandler(async (req, res) => {
    await rides.join(req.ride.id, req.rider.id);
    broadcastToGroup(req.ride.group_id, {
      type: "ride_joined",
      groupId: req.ride.group_id,
      rideId: req.ride.id,
      userId: req.rider.id,
    });
    res.json(await rides.detail(req.ride.id, req.rider.id));
  }),
);

/** Ends the ride for the whole group. */
rideRoutes.post(
  "/:id/end",
  participant,
  asyncHandler(async (req, res) => {
    const ride = await rides.end(req.ride, req.rider.id);
    broadcastToGroup(ride.group_id, {
      type: "ride_ended",
      groupId: ride.group_id,
      rideId: ride.id,
      endedAt: ride.ended_at,
    });
    res.json(await rides.detail(ride.id, req.rider.id));
  }),
);

/** Leaves the ride without ending it for anyone else. */
rideRoutes.post(
  "/:id/leave",
  participant,
  asyncHandler(async (req, res) => {
    const { rideEnded } = await rides.leave(req.ride.id, req.rider.id);
    broadcastToGroup(req.ride.group_id, {
      // The last rider leaving ends the ride for the whole group.
      type: rideEnded ? "ride_ended" : "ride_left",
      groupId: req.ride.group_id,
      rideId: req.ride.id,
      userId: req.rider.id,
    });
    res.status(204).end();
  }),
);
