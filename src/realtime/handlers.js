import { isMember } from "../services/groups.service.js";
import * as locations from "../services/locations.service.js";
import * as messages from "../services/messages.service.js";
import * as rides from "../services/rides.service.js";
import * as sos from "../services/sos.service.js";
import {
  requiredId,
  requiredLatitude,
  requiredLongitude,
  requiredString,
} from "../middleware/validate.js";
import { broadcastToGroup, rememberGroup, send, sendToRider } from "./hub.js";

/** Peer-to-peer call signalling is relayed untouched between two riders. */
const SIGNALLING_EVENTS = new Set([
  "call_offer",
  "call_answer",
  "call_rejected",
  "call_ended",
  "ice_candidate",
]);

/**
 * Confirms the client may act on this group. The cached set is refreshed from
 * the database first, so a rider who just joined a group over REST does not
 * have to reconnect.
 */
async function authorizeGroup(client, event) {
  if (!event.groupId) return false;
  // Clients may send the id as a number; the cached set holds strings.
  event.groupId = requiredId(event.groupId, "Group id");
  if (client.groupIds.has(event.groupId)) return true;
  if (!(await isMember(event.groupId, client.rider.id))) return false;
  rememberGroup(client, event.groupId);
  return true;
}

async function onLocationUpdate(client, event) {
  const latitude = requiredLatitude(event.latitude);
  const longitude = requiredLongitude(event.longitude);
  // Trust the server's view of the active ride rather than the client's, and
  // count this rider as part of it.
  const rideId = await rides.activeParticipation(event.groupId, client.rider.id);
  const saved = await locations.record({
    riderId: client.rider.id,
    groupId: event.groupId,
    rideId,
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(event.accuracy)) ? Number(event.accuracy) : null,
  });
  broadcastToGroup(
    event.groupId,
    {
      type: "location_update",
      groupId: event.groupId,
      rideId: saved.ride_id,
      userId: client.rider.id,
      name: client.rider.name,
      latitude: saved.latitude,
      longitude: saved.longitude,
      accuracy: saved.accuracy,
      timestamp: saved.updated_at,
      online: true,
    },
    client.ws,
  );
}

async function onChatMessage(client, event) {
  const message = await messages.create(event.groupId, client.rider.id, {
    text: requiredString(event.text, "Message", { max: 2000 }),
  });
  // Echoed to the sender too, so their optimistic message gets a real id.
  broadcastToGroup(event.groupId, {
    type: "chat_message",
    ...message,
    clientId: event.clientId ?? null,
    status: "sent",
  });
}

function onTyping(client, event) {
  broadcastToGroup(
    event.groupId,
    {
      type: "typing",
      groupId: event.groupId,
      userId: client.rider.id,
      name: client.rider.name,
      isTyping: event.isTyping !== false,
    },
    client.ws,
  );
}

async function onSosTrigger(client, event) {
  const alert = await sos.trigger({
    groupId: event.groupId,
    riderId: client.rider.id,
    latitude: requiredLatitude(event.latitude),
    longitude: requiredLongitude(event.longitude),
  });
  broadcastToGroup(event.groupId, { type: "sos_trigger", ...alert });
}

async function onSosCancel(client, event) {
  const alert = await sos.cancel({ groupId: event.groupId, riderId: client.rider.id });
  broadcastToGroup(event.groupId, { type: "sos_cancel", ...alert });
}

const GROUP_HANDLERS = {
  location_update: onLocationUpdate,
  chat_message: onChatMessage,
  typing: onTyping,
  sos_trigger: onSosTrigger,
  sos_cancel: onSosCancel,
};

export async function handleEvent(client, event) {
  if (!event || typeof event.type !== "string") return;

  if (event.type === "ping") return void send(client.ws, { type: "pong" });

  if (SIGNALLING_EVENTS.has(event.type)) {
    if (!event.to) return;
    sendToRider(requiredId(event.to, "Recipient id"), {
      ...event,
      from: client.rider.id,
      fromName: client.rider.name,
    });
    return;
  }

  const handler = GROUP_HANDLERS[event.type];
  if (!handler) return;
  if (!(await authorizeGroup(client, event)))
    return void send(client.ws, {
      type: "error",
      event: event.type,
      detail: "You are not a member of that group",
    });

  await handler(client, event);
}
