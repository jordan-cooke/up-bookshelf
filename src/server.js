import mysql from "mysql2/promise";
import { createApp } from "./app.js";
import { initializeDatabase } from "./repository.js";

const config = {
  port: Number(process.env.PORT || 3000),
  appPassword: process.env.APP_PASSWORD || "",
  trustProxy: process.env.TRUST_PROXY === "1",
  database: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "bookshelf",
    user: process.env.DB_USER || "bookshelf",
    password: process.env.DB_PASSWORD || "bookshelf",
    connectionLimit: 10,
    charset: "utf8mb4",
  },
};

const pool = mysql.createPool(config.database);

async function waitForDatabase(attempts = 30) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await initializeDatabase(pool);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`Database is not ready (attempt ${attempt}/${attempts}); retrying in 2 seconds.`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

await waitForDatabase();
const app = createApp({ pool, appPassword: config.appPassword, trustProxy: config.trustProxy });
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`JnC Bookshelf is listening on port ${config.port}.`);
});

async function shutDown(signal) {
  console.log(`${signal} received; closing the bookshelf.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutDown("SIGTERM"));
process.on("SIGINT", () => shutDown("SIGINT"));
