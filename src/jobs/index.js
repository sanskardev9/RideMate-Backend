import { env } from "../config/env.js";
import { endStaleRides } from "../services/rides.service.js";
import { broadcastToGroup } from "../realtime/hub.js";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Closes rides everyone has walked away from, so a group is never left unable
 * to start a new one because somebody closed the app mid-ride.
 */
export function startRideSweeper() {
  const run = async () => {
    try {
      for (const ride of await endStaleRides(env.rideIdleSeconds)) {
        console.log(`[rides] ended abandoned ride ${ride.id}`);
        broadcastToGroup(ride.group_id, {
          type: "ride_ended",
          groupId: String(ride.group_id),
          rideId: String(ride.id),
          reason: "abandoned",
        });
      }
    } catch (error) {
      console.error("[rides] sweep failed", error);
    }
  };

  void run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
