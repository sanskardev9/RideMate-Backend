import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { ApiError, asyncHandler } from "../middleware/errors.js";
import {
  requiredLatitude,
  requiredLongitude,
  requiredId,
} from "../middleware/validate.js";
import * as sos from "../services/sos.service.js";
import { broadcastToGroup } from "../realtime/hub.js";
import { isMember } from "../services/groups.service.js";

export const sosRoutes = Router();

sosRoutes.use(requireAuth);

const assertMembership = async (groupId, riderId) => {
  requiredId(groupId, "Group id");
  if (!(await isMember(groupId, riderId)))
    throw ApiError.forbidden("You are not a member of this group");
};

/** REST equivalent of the `sos_trigger` websocket event. */
sosRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const groupId = req.body?.groupId;
    await assertMembership(groupId, req.rider.id);
    const alert = await sos.trigger({
      groupId,
      riderId: req.rider.id,
      latitude: requiredLatitude(req.body?.latitude),
      longitude: requiredLongitude(req.body?.longitude),
    });
    broadcastToGroup(groupId, { type: "sos_trigger", ...alert });
    res.status(201).json(alert);
  }),
);

sosRoutes.post(
  "/cancel",
  asyncHandler(async (req, res) => {
    const groupId = req.body?.groupId;
    await assertMembership(groupId, req.rider.id);
    const alert = await sos.cancel({ groupId, riderId: req.rider.id });
    broadcastToGroup(groupId, { type: "sos_cancel", ...alert });
    res.json(alert);
  }),
);
