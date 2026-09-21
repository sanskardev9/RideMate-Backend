import { many, one, transaction } from "../db/index.js";
import { env } from "../config/env.js";
import { ApiError } from "../middleware/errors.js";
import { requiredString, requiredId } from "../middleware/validate.js";

const GROUP_COLUMNS = `
  g.id,
  g.name,
  g.invite_code,
  g.owner_id,
  g.created_at,
  active.id as active_ride_id,
  active.started_at as ride_started_at,
  (select count(*)::int from group_members where group_id = g.id) as member_count
`;

const ACTIVE_RIDE_JOIN = `
  left join lateral (
    select r.id, r.started_at from rides r
    where r.group_id = g.id and r.ended_at is null
    limit 1
  ) active on true
`;

export async function isMember(groupId, riderId) {
  if (!groupId || !riderId) return false;
  const row = await one(
    "select 1 from group_members where group_id = $1 and rider_id = $2",
    [requiredId(groupId, "Group id"), String(riderId)],
  );
  return Boolean(row);
}

export const listForRider = (riderId) =>
  many(
    `select ${GROUP_COLUMNS}
     from groups g
     join group_members gm on gm.group_id = g.id
     ${ACTIVE_RIDE_JOIN}
     where gm.rider_id = $1
     order by g.created_at`,
    [riderId],
  );

export async function findForRider(groupId, riderId) {
  const group = await one(
    `select ${GROUP_COLUMNS}
     from groups g
     join group_members gm on gm.group_id = g.id and gm.rider_id = $2
     ${ACTIVE_RIDE_JOIN}
     where g.id = $1`,
    [groupId, riderId],
  );
  if (!group) throw ApiError.notFound("Group not found");
  return group;
}

export async function create(body, riderId) {
  const name = requiredString(body?.name, "Group name", { min: 2, max: 60 });
  return transaction(async (client) => {
    const { rows } = await client.query(
      "insert into groups (name, owner_id) values ($1, $2) returning *",
      [name, riderId],
    );
    const group = rows[0];
    await client.query(
      "insert into group_members (group_id, rider_id) values ($1, $2)",
      [group.id, riderId],
    );
    return { ...group, active_ride_id: null, ride_started_at: null, member_count: 1 };
  });
}

export async function joinByCode(body, riderId) {
  const code = requiredString(body?.code, "Invite code", { min: 4, max: 24 }).toUpperCase();
  const group = await one("select id from groups where invite_code = $1", [code]);
  if (!group) throw ApiError.notFound("No group uses that invite code");

  await one(
    `insert into group_members (group_id, rider_id) values ($1, $2)
     on conflict do nothing returning group_id`,
    [group.id, riderId],
  );
  return findForRider(group.id, riderId);
}

export async function leave(groupId, riderId) {
  await transaction(async (client) => {
    const { rows } = await client.query(
      "select owner_id from groups where id = $1",
      [groupId],
    );
    const { rows: members } = await client.query(
      "select rider_id from group_members where group_id = $1",
      [groupId],
    );
    if (rows[0]?.owner_id === riderId && members.length > 1)
      throw ApiError.badRequest(
        "Hand the group over to another rider before leaving, or remove the other members first",
      );

    await client.query(
      "delete from group_members where group_id = $1 and rider_id = $2",
      [groupId, riderId],
    );
    await client.query(
      "delete from locations where group_id = $1 and rider_id = $2",
      [groupId, riderId],
    );
    // The last rider out takes the group with them.
    if (members.length <= 1) await client.query("delete from groups where id = $1", [groupId]);
  });
}

/** Members with presence derived from how recently they reported a location. */
export const listMembers = (groupId) =>
  many(
    `select
       r.id,
       r.name,
       r.email,
       r.avatar_url,
       l.updated_at as last_location_at,
       (l.updated_at is not null
         and l.updated_at > now() - make_interval(secs => $2)) as online
     from group_members gm
     join riders r on r.id = gm.rider_id
     left join locations l on l.rider_id = r.id and l.group_id = gm.group_id
     where gm.group_id = $1
     order by r.name`,
    [groupId, env.presenceWindowSeconds],
  );

/** Every group id this rider belongs to, used to scope realtime broadcasts. */
export async function listGroupIds(riderId) {
  const rows = await many("select group_id from group_members where rider_id = $1", [riderId]);
  return rows.map((row) => String(row.group_id));
}
