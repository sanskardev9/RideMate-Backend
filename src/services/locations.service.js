import { many, one, transaction } from "../db/index.js";
import { env } from "../config/env.js";

/**
 * Stores the rider's latest position and, while a ride is running, appends a
 * breadcrumb so the ride's distance can be measured afterwards.
 */
export function record({ riderId, groupId, rideId = null, latitude, longitude, accuracy = null }) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `insert into locations (rider_id, group_id, ride_id, latitude, longitude, accuracy)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (rider_id) do update set
         group_id = excluded.group_id,
         ride_id = excluded.ride_id,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         accuracy = excluded.accuracy,
         updated_at = now()
       returning *`,
      [riderId, groupId, rideId, latitude, longitude, accuracy],
    );
    if (rideId)
      await client.query(
        `insert into ride_tracks (ride_id, rider_id, latitude, longitude, accuracy)
         values ($1, $2, $3, $4, $5)`,
        [rideId, riderId, latitude, longitude, accuracy],
      );
    return rows[0];
  });
}

export const listForGroup = (groupId) =>
  many(
    `select
       l.rider_id as user_id,
       r.name,
       r.avatar_url,
       l.latitude,
       l.longitude,
       l.accuracy,
       l.ride_id,
       l.updated_at as timestamp,
       (l.updated_at > now() - make_interval(secs => $2)) as online
     from locations l
     join riders r on r.id = l.rider_id
     -- Positions are only visible while the ride they belong to is running.
     join rides ride on ride.id = l.ride_id and ride.ended_at is null
     where l.group_id = $1
     order by l.updated_at desc`,
    [groupId, env.presenceWindowSeconds],
  );

export const forRider = (riderId) =>
  one("select * from locations where rider_id = $1", [riderId]);
