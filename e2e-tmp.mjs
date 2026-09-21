import WebSocket from "ws";
const BASE = "http://localhost:8099";
let pass = 0, fail = 0;
const ok = (c, label, extra = "") => { c ? (pass++, console.log("  PASS", label)) : (fail++, console.log("  FAIL", label, extra)); };

async function call(path, { method = "GET", token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

const stamp = Date.now();
const alice = { name: "Alice Rider", email: `alice.${stamp}@ridemate.test`, password: "supersecret1" };
const bob = { name: "Bob Rider", email: `bob.${stamp}@ridemate.test`, password: "supersecret1" };

console.log("\n== auth ==");
let r = await call("/auth/register", { method: "POST", body: alice });
ok(r.status === 201 && r.body.access_token, "register alice", JSON.stringify(r.body));
alice.token = r.body.access_token; alice.id = r.body.user.id;
ok(typeof alice.id === "string" && /^\d+$/.test(alice.id), "rider id is a numeric string", alice.id);

r = await call("/auth/register", { method: "POST", body: bob });
bob.token = r.body.access_token; bob.id = r.body.user.id;
ok(r.status === 201, "register bob");

r = await call("/auth/register", { method: "POST", body: alice });
ok(r.status === 409, "duplicate email rejected", r.status);
r = await call("/auth/register", { method: "POST", body: { ...bob, email: `x.${stamp}@t.co`, password: "short" } });
ok(r.status === 400, "short password rejected", r.status);
r = await call("/auth/login", { method: "POST", body: { email: alice.email, password: "wrongpassword" } });
ok(r.status === 401, "wrong password rejected", r.status);
r = await call("/auth/login", { method: "POST", body: { email: alice.email, password: alice.password } });
ok(r.status === 200 && r.body.access_token, "login works");
ok(!("password_hash" in r.body.user), "password hash never leaks");
r = await call("/auth/me", { token: alice.token });
ok(r.status === 200 && r.body.id === alice.id, "GET /auth/me");
r = await call("/auth/me");
ok(r.status === 401, "unauthenticated /auth/me rejected");
r = await call("/auth/me", { token: "garbage.token.here" });
ok(r.status === 401, "invalid token rejected");

console.log("\n== groups ==");
r = await call("/groups", { method: "POST", token: alice.token, body: { name: "Trailblazers" } });
ok(r.status === 201 && r.body.invite_code, "create group", JSON.stringify(r.body));
const group = r.body;
r = await call("/groups", { token: alice.token });
ok(r.status === 200 && r.body.length === 1 && r.body[0].member_count === 1, "list groups", JSON.stringify(r.body));

console.log("\n== authorization ==");
r = await call(`/groups/${group.id}/messages`, { token: bob.token });
ok(r.status === 403, "non-member cannot read another group's chat", r.status);
r = await call(`/groups/${group.id}/locations`, { token: bob.token });
ok(r.status === 403, "non-member cannot read another group's locations", r.status);
r = await call(`/groups/${group.id}`, { token: bob.token });
ok(r.status === 403, "non-member cannot read group detail", r.status);
r = await call("/groups/not-a-number/messages", { token: alice.token });
ok(r.status === 400, "malformed id rejected with 400", r.status);

console.log("\n== join ==");
r = await call("/groups/join", { method: "POST", token: bob.token, body: { code: group.invite_code.toLowerCase() } });
ok(r.status === 200 && r.body.member_count === 2, "bob joins by invite code (case-insensitive)", JSON.stringify(r.body));
r = await call("/groups/join", { method: "POST", token: bob.token, body: { code: "NOPE99" } });
ok(r.status === 404, "unknown invite code rejected");
r = await call(`/groups/${group.id}/messages`, { token: bob.token });
ok(r.status === 200, "member can now read chat");
r = await call(`/groups/${group.id}/members`, { token: alice.token });
ok(r.status === 200 && r.body.length === 2 && r.body.every((m) => m.online === false), "members listed, all offline before any location");

console.log("\n== rides ==");
r = await call(`/groups/${group.id}/rides`, { method: "POST", token: alice.token });
ok(r.status === 201, "start ride");
const ride = r.body;
r = await call(`/groups/${group.id}/rides`, { method: "POST", token: bob.token });
ok(r.status === 201 && r.body.id === ride.id, "second start joins the running ride", JSON.stringify(r.body));
r = await call(`/groups/${group.id}`, { token: alice.token });
ok(r.body.active_ride_id === ride.id, "group reports its active ride");
r = await call(`/rides/${ride.id}`, { token: alice.token });
ok(r.status === 200 && r.body.distance_km === 0 && r.body.rider_count === 2, "ride stats start at zero", JSON.stringify(r.body));
ok(r.body.group_name === "Trailblazers", "ride carries the real group name");

console.log("\n== websocket ==");
const connect = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:8099/ws?token=${encodeURIComponent(token)}`);
  ws.events = [];
  ws.on("message", (raw) => ws.events.push(JSON.parse(raw)));
  ws.on("open", () => resolve(ws));
  ws.on("error", reject);
  ws.on("close", (code) => reject(new Error("closed " + code)));
});
const settle = (ms = 1200) => new Promise((res) => setTimeout(res, ms));
const ready = (ws) => new Promise((res) => {
  const check = () => (ws.events.some((e) => e.type === "groups_ready") ? res() : setTimeout(check, 50));
  check();
});

await new Promise((resolve) => {
  const bad = new WebSocket("ws://localhost:8099/ws?token=bogus");
  bad.on("close", (code) => { ok(code === 1008, "websocket rejects a bad token", code); resolve(); });
  bad.on("error", () => {});
});

const aliceWs = await connect(alice.token);
const bobWs = await connect(bob.token);
await Promise.all([ready(aliceWs), ready(bobWs)]);
await settle();
ok(aliceWs.events.some((e) => e.type === "connected"), "connected event");
ok(aliceWs.events.some((e) => e.type === "presence" && e.online === true), "presence broadcast on connect");

// Two points ~1.1 km apart in Gurugram.
aliceWs.send(JSON.stringify({ type: "location_update", groupId: group.id, latitude: 28.4595, longitude: 77.0266 }));
await settle();
aliceWs.send(JSON.stringify({ type: "location_update", groupId: group.id, latitude: 28.4695, longitude: 77.0266 }));
await settle();
const loc = bobWs.events.find((e) => e.type === "location_update");
ok(loc && loc.userId === alice.id && loc.rideId === ride.id, "location relayed with the server's ride id", JSON.stringify(loc));

r = await call(`/rides/${ride.id}`, { token: alice.token });
ok(r.body.distance_km > 1 && r.body.distance_km < 1.3, `distance computed from tracks (got ${r.body.distance_km} km)`);
ok(r.body.duration_seconds >= 0, "duration computed");
r = await call(`/groups/${group.id}/members`, { token: alice.token });
ok(r.body.find((m) => m.id === alice.id).online === true, "alice now shows online");

aliceWs.send(JSON.stringify({ type: "chat_message", groupId: group.id, text: "Heading out now", clientId: "c1" }));
await settle();
const chat = bobWs.events.find((e) => e.type === "chat_message");
ok(chat && chat.text === "Heading out now" && chat.sender === "Alice Rider", "chat relayed with sender name", JSON.stringify(chat));
ok(aliceWs.events.some((e) => e.type === "chat_message" && e.clientId === "c1"), "sender gets an echo carrying clientId");
r = await call(`/groups/${group.id}/messages`, { token: bob.token });
ok(r.body.length === 1 && r.body[0].text === "Heading out now", "message persisted and readable");

aliceWs.send(JSON.stringify({ type: "typing", groupId: group.id, isTyping: true }));
await settle();
ok(bobWs.events.some((e) => e.type === "typing" && e.name === "Alice Rider"), "typing indicator relayed");
ok(!aliceWs.events.some((e) => e.type === "typing"), "typing not echoed to the sender");

aliceWs.send(JSON.stringify({ type: "sos_trigger", groupId: group.id, latitude: 28.46, longitude: 77.02 }));
await settle();
ok(bobWs.events.some((e) => e.type === "sos_trigger" && e.rider_name === "Alice Rider"), "SOS broadcast");
r = await call(`/groups/${group.id}/sos`, { token: bob.token });
ok(r.body.length === 1 && r.body[0].active === true, "active SOS listed over REST");
aliceWs.send(JSON.stringify({ type: "sos_cancel", groupId: group.id }));
await settle();
ok(bobWs.events.some((e) => e.type === "sos_cancel"), "SOS cancel broadcast (was silently ignored before)");
r = await call(`/groups/${group.id}/sos`, { token: bob.token });
ok(r.body.length === 0, "cancelled SOS no longer active");

// A group Bob is not in.
r = await call("/groups", { method: "POST", token: alice.token, body: { name: "Secret Crew" } });
const secret = r.body;
bobWs.events.length = 0;
bobWs.send(JSON.stringify({ type: "chat_message", groupId: secret.id, text: "sneaking in" }));
await settle();
ok(bobWs.events.some((e) => e.type === "error"), "websocket rejects events for a group you are not in");
r = await call(`/groups/${secret.id}/messages`, { token: alice.token });
ok(r.body.length === 0, "...and nothing was written");

// Membership cache refresh: Bob joins over REST, then sends over the existing socket.
await call("/groups/join", { method: "POST", token: bob.token, body: { code: secret.invite_code } });
bobWs.events.length = 0;
bobWs.send(JSON.stringify({ type: "chat_message", groupId: secret.id, text: "now a member" }));
await settle();
r = await call(`/groups/${secret.id}/messages`, { token: alice.token });
ok(r.body.length === 1, "stale socket membership refreshes after a REST join");

console.log("\n== ending rides ==");
r = await call(`/rides/${ride.id}/leave`, { method: "POST", token: bob.token });
ok(r.status === 204, "bob leaves the ride");
r = await call(`/rides/${ride.id}`, { token: alice.token });
ok(r.body.rider_count === 1, "rider count drops after leaving, ride continues", JSON.stringify(r.body));
r = await call(`/rides/${ride.id}/end`, { method: "POST", token: bob.token });
ok(r.status === 403, "non-starter cannot end the ride for everyone", r.status);
r = await call(`/rides/${ride.id}/end`, { method: "POST", token: alice.token });
ok(r.status === 200 && r.body.ended_at, "starter ends the ride");
r = await call(`/groups/${group.id}`, { token: alice.token });
ok(r.body.active_ride_id === null, "group has no active ride afterwards");

console.log("\n== leaving ==");
r = await call(`/groups/${group.id}/members/me`, { method: "DELETE", token: alice.token });
ok(r.status === 400, "owner cannot abandon a group with other members", r.status);
r = await call(`/groups/${group.id}/members/me`, { method: "DELETE", token: bob.token });
ok(r.status === 204, "member leaves");
r = await call(`/groups/${group.id}/members`, { token: bob.token });
ok(r.status === 403, "...and loses access");

aliceWs.close(); bobWs.close();
await settle(300);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
