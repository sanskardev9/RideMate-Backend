import "dotenv/config";

const required = ["DATABASE_URL", "JWT_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length)
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

/**
 * Browsers send an Origin with no trailing slash and no quotes. Dashboard
 * values routinely carry both, which silently blocks every request, so both
 * sides are normalised to the same shape before they are compared.
 */
export const normalizeOrigin = (value) =>
  String(value)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "")
    .toLowerCase();

const list = (value) =>
  String(value || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

export const env = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL,
  poolMax: Number(process.env.PG_POOL_MAX || 10),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  // An empty CLIENT_ORIGIN allows any origin, which suits local development only.
  clientOrigins: list(process.env.CLIENT_ORIGIN),
  // A rider counts as online while their last location update is this recent.
  presenceWindowSeconds: Number(process.env.PRESENCE_WINDOW_SECONDS || 120),
  // A ride whose riders have all stopped reporting for this long is over:
  // somebody closed the app without ending it, and without this the group
  // could never start another ride.
  rideIdleSeconds: Number(process.env.RIDE_IDLE_SECONDS || 900),
  // Chat history returned by default from GET /groups/:id/messages.
  messagePageSize: Number(process.env.MESSAGE_PAGE_SIZE || 100),
};

export const isProduction = env.nodeEnv === "production";
