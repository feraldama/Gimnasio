// Run a migration SQL file against the configured Postgres DB.
//
// Usage:
//   node api/scripts/run-migration.js <file>
//
// Reads connection params from api/.env. Splits on `;` is not safe with
// dollar-quoted blocks; instead we send the whole file as one statement to
// pg, relying on the file's own BEGIN/COMMIT to wrap things.
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: node api/scripts/run-migration.js <file>");
  process.exit(1);
}
const filePath = path.isAbsolute(fileArg)
  ? fileArg
  : path.join(__dirname, "..", "migrations", fileArg);

if (!fs.existsSync(filePath)) {
  console.error("Migration file not found:", filePath);
  process.exit(1);
}

const sql = fs.readFileSync(filePath, "utf8");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "gimnasio",
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

(async () => {
  const client = await pool.connect();
  try {
    console.log("Applying migration:", path.basename(filePath));
    console.log("Database:", process.env.DB_NAME || "gimnasio");
    await client.query(sql);
    console.log("OK");
  } catch (e) {
    console.error("Migration failed:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
