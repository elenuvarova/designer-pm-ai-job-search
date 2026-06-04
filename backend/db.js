// Dialect is picked from DATABASE_URL so the same config works locally (SQLite)
// and on Render (Postgres) without any code changes.
import { Sequelize } from "sequelize";

let sequelize;
let dbKind;

const url = process.env.DATABASE_URL || "";

if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
  dbKind = "postgres";
  // Enable SSL only when the connection string asks for it (e.g. Neon's
  // ?sslmode=require). The internal Coolify Postgres does NOT support SSL,
  // so forcing it there makes the connection fail and the app crash-loop.
  const sslOptions = /sslmode=require/i.test(url)
    ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
    : {};
  sequelize = new Sequelize(url, {
    dialect: "postgres",
    logging: false,
    ...sslOptions,
  });
} else {
  dbKind = "sqlite";
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: process.env.SQLITE_PATH || "./data.sqlite",
    logging: false,
  });
}

export { sequelize, dbKind };
