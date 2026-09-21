/**
 * Registry of live websocket connections.
 *
 * Route handlers import `broadcastToGroup` to push changes made over REST to
 * connected riders, so both transports stay in sync.
 */
const clients = new Map(); // ws -> { ws, rider, groupIds:Set, alive:boolean }

export const clientFor = (ws) => clients.get(ws);
export const connectionCount = () => clients.size;

export function addClient(ws, rider, groupIds) {
  const client = {
    ws,
    rider,
    groupIds: new Set(groupIds),
    alive: true,
    // Set once the rider's groups have been loaded from the database.
    groupsLoaded: false,
    // Broadcasts that arrived during that window, replayed by flushPending.
    pending: [],
  };
  clients.set(ws, client);
  return client;
}

export const removeClient = (ws) => clients.delete(ws);

export function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

/** Sends to everyone in the group, optionally skipping the originating socket. */
export function broadcastToGroup(groupId, payload, exceptWs) {
  let delivered = 0;
  const group = String(groupId);
  for (const client of clients.values()) {
    if (client.ws === exceptWs) continue;
    // Membership is still loading: hold the payload rather than drop it, so a
    // rider connecting mid-ride does not silently lose a chat message.
    if (!client.groupsLoaded) {
      client.pending.push({ groupId: group, payload });
      continue;
    }
    if (!client.groupIds.has(group)) continue;
    if (send(client.ws, payload)) delivered += 1;
  }
  return delivered;
}

/** Sends to every connection a single rider has open (phone plus browser). */
export function sendToRider(riderId, payload) {
  let delivered = 0;
  for (const client of clients.values())
    if (String(client.rider.id) === String(riderId) && send(client.ws, payload)) delivered += 1;
  return delivered;
}

export const isRiderOnline = (riderId) => {
  for (const client of clients.values())
    if (String(client.rider.id) === String(riderId)) return true;
  return false;
};

/** Keeps a client's cached group set current after it joins a group over REST. */
export const rememberGroup = (client, groupId) => client.groupIds.add(groupId);

/** Delivers whatever arrived while the client's group list was loading. */
export function flushPending(client) {
  const held = client.pending;
  client.pending = [];
  client.groupsLoaded = true;
  let delivered = 0;
  for (const { groupId, payload } of held)
    if (client.groupIds.has(groupId) && send(client.ws, payload)) delivered += 1;
  return delivered;
}
