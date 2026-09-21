import { many, one, transaction } from "../db/index.js";
import { ApiError } from "../middleware/errors.js";

export const findRide = (rideId) =>
  one("select * from rides where id = $1", [rideId]);

export const activeForGroup = (groupId) =>
  one("select * from rides where group_id = $1 and ended_at is null", [groupId]);

/** Starts a ride, or returns the one already running for the group. */
export async function start(groupId, riderId) {
  const running = await activeForGroup(groupId);
  if (running) {
    await join(running.id, riderId);
    return running;
  }
  return transaction(async (client) => {
    const { rows } = await client.query(
      "insert into rides (group_id, started_by) values ($1, $2) returning *",
      [groupId, riderId],
    );
    const ride = rows[0];
    await client.query(
      "insert into ride_participants (ride_id, rider_id) values ($1, $2)",
      [ride.id, riderId],
    );
    return ride;
  });
}

/**
 * Resolves the ride a rider's location belongs to, enrolling them in the
 * group's running ride on their first update. A rider streaming their position
 * while the group is out is on the ride, whether or not they pressed Start.
 * Riders who explicitly ended the ride for themselves stay out of it, so this
 * never resurrects a `left_at`.
 *
 * Returns the ride id to attribute the location to, or null when the group is
 * not riding or this rider has left.
 */
export async function activeParticipation(groupId, riderId) {
  const row = await one(
    `with active as (
       select id from rides where group_id = $1 and ended_at is null limit 1
     ), participation as (
       insert into ride_participants (ride_id, rider_id)
       select active.id, $2 from active
       on conflict (ride_id, rider_id)
         do update set left_at = ride_participants.left_at
       returning ride_id, left_at
     )
     select ride_id, left_at from participation`,
    [groupId, riderId],
  );
  return row && row.left_at === null ? String(row.ride_id) : null;
}

export const join = (rideId, riderId) =>
  one(
    `insert into ride_participants (ride_id, rider_id) values ($1, $2)
     on conflict (ride_id, rider_id) do update set left_at = null
     returning ride_id`,
    [rideId, riderId],
  );

/** Ride detail with stats computed from recorded track points. */
export async function detail(rideId, riderId) {
  const ride = await one(
    `select
       ride.id,
       ride.group_id,
       ride.started_by,
       ride.started_at,
       ride.ended_at,
       g.name as group_name,
       g.invite_code,
       extract(epoch from coalesce(ride.ended_at, now()) - ride.started_at)::int
         as duration_seconds,
       round(ride_distance_km(ride.id)::numeric, 2)::float as distance_km,
       (select count(*)::int from ride_participants p
         where p.ride_id = ride.id and p.left_at is null) as rider_count,
       exists (
         select 1 from ride_participants p
         where p.ride_id = ride.id and p.rider_id = $2 and p.left_at is null
       ) as joined
     from rides ride
     join groups g on g.id = ride.group_id
     where ride.id = $1`,
    [rideId, riderId],
  );
  if (!ride) throw ApiError.notFound("Ride not found");
  return ride;
}

export const participants = (rideId) =>
  many(
    `select r.id, r.name, r.avatar_url, p.joined_at, p.left_at
     from ride_participants p
     join riders r on r.id = p.rider_id
     where p.ride_id = $1
     order by p.joined_at`,
    [rideId],
  );

export const listForGroup = (groupId, limit) =>
  many(
    `select
       id, started_by, started_at, ended_at,
       round(ride_distance_km(id)::numeric, 2)::float as distance_km
     from rides
     where group_id = $1
     order by started_at desc
     limit $2`,
    [groupId, limit],
  );

/**
 * Ends rides nobody is on any more. A rider who closes the app never sends
 * `leave`, so they stay an active participant forever and the group is stuck
 * with a ride that cannot end. A ride counts as abandoned once no remaining
 * participant has reported a position within the idle window.
 */
export const endStaleRides = (idleSeconds) =>
  many(
    `with abandoned as (
       select r.id, r.group_id
       from rides r
       where r.ended_at is null
         and r.started_at < now() - make_interval(secs => $1)
         and not exists (
           select 1
           from ride_participants p
           join locations l on l.rider_id = p.rider_id and l.ride_id = r.id
           where p.ride_id = r.id
             and p.left_at is null
             and l.updated_at > now() - make_interval(secs => $1)
         )
     ), closed as (
       update rides set ended_at = now()
       where id in (select id from abandoned)
       returning id, group_id
     ), released as (
       update ride_participants set left_at = now()
       where ride_id in (select id from closed) and left_at is null
       returning ride_id
     ), erased as (
       delete from locations where ride_id in (select id from closed)
       returning rider_id
     )
     select id, group_id from closed`,
    [idleSeconds],
  );

/** Ends the ride for everyone. Only the starter or the group owner may do it. */
export async function end(ride, riderId) {
  const group = await one("select owner_id from groups where id = $1", [ride.group_id]);
  const rider = String(riderId);
  if (String(ride.started_by) !== rider && String(group?.owner_id) !== rider)
    throw ApiError.forbidden("Only the rider who started this ride can end it for everyone");
  if (ride.ended_at) return ride;

  return transaction(async (client) => {
    const { rows } = await client.query(
      "update rides set ended_at = now() where id = $1 and ended_at is null returning *",
      [ride.id],
    );
    await client.query(
      "update ride_participants set left_at = now() where ride_id = $1 and left_at is null",
      [ride.id],
    );
    // Erase the trail of live positions; the ride is over.
    await client.query("delete from locations where ride_id = $1", [ride.id]);
    return rows[0] ?? ride;
  });
}

/** Ends the ride for one rider only; the group keeps riding. */
export async function leave(rideId, riderId) {
  return transaction(async (client) => {
    await client.query(
      "update ride_participants set left_at = now() where ride_id = $1 and rider_id = $2 and left_at is null",
      [rideId, riderId],
    );
    await client.query(
      "delete from locations where rider_id = $1 and ride_id = $2",
      [riderId, rideId],
    );
    // The last rider out ends the ride. Otherwise it would stay open with
    // nobody on it, and the unique active-ride index would block a new one.
    const { rows } = await client.query(
      `update rides set ended_at = now()
       where id = $1 and ended_at is null
         and not exists (
           select 1 from ride_participants p
           where p.ride_id = $1 and p.left_at is null
         )
       returning id`,
      [rideId],
    );
    return { rideEnded: rows.length > 0 };
  });
}
