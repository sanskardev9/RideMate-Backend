import "dotenv/config";

const required = ["DATABASE_URL", "JWT_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length)
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

const list = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
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
  // Chat history returned by default from GET /groups/:id/messages.
  messagePageSize: Number(process.env.MESSAGE_PAGE_SIZE || 100),
};

export const isProduction = env.nodeEnv === "production";
