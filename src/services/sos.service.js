import { many, one } from "../db/index.js";
import { ApiError } from "../middleware/errors.js";

const ALERT_COLUMNS = `
  s.id,
  s.group_id,
  s.rider_id,
  r.name as rider_name,
  s.latitude,
  s.longitude,
  s.active,
  s.created_at,
  s.cancelled_at
`;

/**
 * Raises an alert, or refreshes the position on the rider's existing one.
 * Done in a single round trip: an SOS is the one call that must not be slow.
 */
export async function trigger({ groupId, riderId, latitude, longitude }) {
  return one(
    `with refreshed as (
       update sos_alerts set latitude = $3, longitude = $4
       where group_id = $1 and rider_id = $2 and active
       returning *
     ), created as (
       insert into sos_alerts (group_id, rider_id, latitude, longitude)
       select $1, $2, $3, $4
       where not exists (select 1 from refreshed)
       returning *
     ), alert as (
       select * from refreshed union all select * from created
     )
     select ${ALERT_COLUMNS}
     from alert s
     left join riders r on r.id = s.rider_id`,
    [groupId, riderId, latitude, longitude],
  );
}

export async function cancel({ groupId, riderId }) {
  const alert = await one(
    `with cancelled as (
       update sos_alerts set active = false, cancelled_at = now()
       where group_id = $1 and rider_id = $2 and active
       returning id
     )
     select ${ALERT_COLUMNS}
     from sos_alerts s
     left join riders r on r.id = s.rider_id
     where s.id in (select id from cancelled)`,
    [groupId, riderId],
  );
  if (!alert) throw ApiError.notFound("No active SOS alert to cancel");
  return alert;
}

export const find = (id) =>
  one(
    `select ${ALERT_COLUMNS} from sos_alerts s
     left join riders r on r.id = s.rider_id
     where s.id = $1`,
    [id],
  );

export const listActive = (groupId) =>
  many(
    `select ${ALERT_COLUMNS} from sos_alerts s
     left join riders r on r.id = s.rider_id
     where s.group_id = $1 and s.active
     order by s.created_at desc`,
    [groupId],
  );
