import { many, one } from "../db/index.js";
import { env } from "../config/env.js";
import { boundedLimit, requiredString } from "../middleware/validate.js";

const MESSAGE_COLUMNS = `
  m.id,
  m.group_id,
  m.sender_id,
  sender.name as sender,
  sender.avatar_url as sender_avatar,
  m.text,
  m.created_at as timestamp
`;

/** Newest-first from the database, returned oldest-first for the chat view. */
export async function list(groupId, { limit, before } = {}) {
  const rows = await many(
    `select ${MESSAGE_COLUMNS}
     from messages m
     left join riders sender on sender.id = m.sender_id
     where m.group_id = $1 and ($3::timestamptz is null or m.created_at < $3)
     order by m.created_at desc
     limit $2`,
    [groupId, boundedLimit(limit, env.messagePageSize, 200), before || null],
  );
  return rows.reverse();
}

export async function create(groupId, senderId, body) {
  const text = requiredString(body?.text, "Message", { max: 2000 });
  const created = await one(
    "insert into messages (group_id, sender_id, text) values ($1, $2, $3) returning id",
    [groupId, senderId, text],
  );
  return one(
    `select ${MESSAGE_COLUMNS}
     from messages m
     left join riders sender on sender.id = m.sender_id
     where m.id = $1`,
    [created.id],
  );
}
