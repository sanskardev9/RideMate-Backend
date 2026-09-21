import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { one } from "../db/index.js";
import { env } from "../config/env.js";
import { ApiError } from "../middleware/errors.js";
import { requiredEmail, requiredString } from "../middleware/validate.js";

const MIN_PASSWORD_LENGTH = 8;

/** The only shape of a rider that ever leaves the API. */
export const publicRider = (row) =>
  row && {
    id: String(row.id),
    name: row.name,
    email: row.email,
    avatar: row.avatar_url ?? null,
  };

export const signToken = (rider) =>
  jwt.sign({ sub: rider.id, name: rider.name, email: rider.email }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

export const verifyToken = (token) => jwt.verify(token, env.jwtSecret);

export async function register(body) {
  const name = requiredString(body?.name, "Name", { max: 80 });
  const email = requiredEmail(body?.email);
  const password = requiredString(body?.password, "Password", {
    min: MIN_PASSWORD_LENGTH,
    max: 200,
  });

  const existing = await one("select id from riders where email = $1", [email]);
  if (existing) throw ApiError.conflict("That email is already registered");

  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const rider = await one(
    `insert into riders (name, email, password_hash)
     values ($1, $2, $3)
     returning id, name, email, avatar_url`,
    [name, email, passwordHash],
  );
  return { access_token: signToken(rider), user: publicRider(rider) };
}

export async function login(body) {
  const email = requiredEmail(body?.email);
  const password = requiredString(body?.password, "Password", { max: 200 });

  const rider = await one("select * from riders where email = $1", [email]);
  // Compare against a dummy hash when the rider is missing so that a wrong
  // email and a wrong password take the same amount of time to answer.
  const hash = rider?.password_hash || "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
  const valid = await bcrypt.compare(password, hash);
  if (!rider || !valid) throw ApiError.unauthorized("Invalid email or password");

  return { access_token: signToken(rider), user: publicRider(rider) };
}

/** Updates the rider's own profile. Only the display name is editable. */
export async function updateProfile(riderId, body) {
  const name = requiredString(body?.name, "Name", { max: 80 });
  const rider = await one(
    `update riders set name = $2 where id = $1
     returning id, name, email, avatar_url`,
    [riderId, name],
  );
  if (!rider) throw ApiError.notFound("Rider not found");
  return { access_token: signToken(rider), user: publicRider(rider) };
}

export async function findRider(riderId) {
  const rider = await one(
    "select id, name, email, avatar_url from riders where id = $1",
    [riderId],
  );
  if (!rider) throw ApiError.notFound("Rider not found");
  return publicRider(rider);
}
