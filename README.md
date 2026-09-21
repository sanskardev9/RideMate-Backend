# RideMate API

Express + Postgres + WebSocket backend for the RideMate app.
Riders sign in, form groups, start a ride, and share live location, chat and
SOS alerts with their group in real time.

## Running it

```bash
cp .env.example .env    # then fill in DATABASE_URL and JWT_SECRET
npm install
npm run dev             # http://localhost:8080
```

Migrations in `sql/` run automatically at startup. Set `AUTO_MIGRATE=false` to
run them yourself with `npm run migrate`.

## Layout

```
src/
  server.js            process entry: boot, migrate, listen, graceful shutdown
  app.js               express app and route mounting
  config/env.js        environment parsing and validation
  db/index.js          connection pool, query helpers, transactions
  db/migrate.js        applies sql/*.sql once each, tracked in schema_migrations
  middleware/          auth guards, validation, error translation
  routes/              HTTP endpoints, kept thin
  services/            all SQL and business rules
  realtime/            websocket server, connection hub, event handlers
sql/                   schema migrations, applied in filename order
```

Ids are `bigint` to match the tables provisioned in Supabase. node-postgres
returns them as strings to avoid precision loss, so **every id is a string**
throughout the API and the client.

## HTTP endpoints

All routes except `/`, `/health`, `/auth/register` and `/auth/login` need
`Authorization: Bearer <token>`. Group and ride routes additionally verify that
the caller is a member.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness plus database check |
| POST | `/auth/register` | Create a rider, returns a token |
| POST | `/auth/login` | Exchange credentials for a token |
| GET | `/auth/me` | The signed-in rider |
| PATCH | `/auth/me` | Rename yourself; returns a fresh token |
| GET | `/groups` | Groups the rider belongs to |
| POST | `/groups` | Create a group (creator joins and owns it) |
| POST | `/groups/join` | Join using an invite code |
| GET | `/groups/:id` | One group, with its active ride |
| DELETE | `/groups/:id/members/me` | Leave; the last rider out deletes the group |
| GET | `/groups/:id/members` | Members with online status |
| GET | `/groups/:id/locations` | Latest position per rider |
| GET | `/groups/:id/messages` | Chat history (`?limit=`, `?before=`) |
| POST | `/groups/:id/messages` | Send chat over HTTP when the socket is down |
| GET | `/groups/:id/rides` | Recent rides |
| POST | `/groups/:id/rides` | Start a ride, or join the running one |
| GET | `/groups/:id/sos` | Active SOS alerts |
| GET | `/rides/:id` | Ride detail with live stats |
| GET | `/rides/:id/participants` | Who is on the ride |
| POST | `/rides/:id/end` | End for everyone (starter or group owner) |
| POST | `/rides/:id/leave` | End for yourself only |
| POST | `/sos` | Raise an alert |
| POST | `/sos/cancel` | Stand your alert down |

Errors are always `{ "detail": "..." }` with a matching status code.

## WebSocket

Connect to `/ws?token=<jwt>`. A bad token is closed with code 1008.

Sent by the client: `location_update`, `chat_message`, `typing`, `sos_trigger`,
`sos_cancel`, `ping`, and the call-signalling events `call_offer`,
`call_answer`, `call_rejected`, `call_ended`, `ice_candidate` (relayed
untouched to the rider named in `to`).

Sent by the server: `connected`, `groups_ready`, `presence`, `location_update`,
`chat_message`, `typing`, `sos_trigger`, `sos_cancel`, `ride_started`,
`ride_ended`, `ride_left`, `member_left`, `error`, `pong`.

Every group event is checked against the sender's membership, re-reading the
database if their cached group list is stale, so joining a group over HTTP
takes effect without reconnecting.

## Ride participation

Pressing *Start a ride* enrols the rider. Anyone else in the group who is
sharing a location while that ride runs is enrolled automatically on their
first update — they are on the ride whether or not they pressed the button.
*End ride for me* sets `left_at`, and continuing to share a location after that
does not re-enrol them.

## Ride stats

`locations` holds only each rider's latest fix. While a ride is running, each
update also appends to `ride_tracks`, and `ride_distance_km()` sums the
haversine distance along the longest single rider's trail. Distance, duration
and rider count on `GET /rides/:id` are all derived from recorded data.
