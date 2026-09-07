// Runner de migraciones con registro de lo aplicado.
//
// El problema que resuelve: `run-migration.js` aplica UN archivo que se le
// pasa a mano y no anota nada. Con 16 migraciones ya es fácil saltarse una al
// montar otro local, o aplicar dos veces algo que no es idempotente, y no hay
// forma de saber en qué estado quedó una base.
//
// Este script mantiene la tabla `schema_migrations` y aplica sólo lo pendiente,
// en orden alfabético (por eso los archivos van numerados 001-, 002-, …).
//
// Uso:
//   node api/scripts/migrate.js --status     ver qué está aplicado y qué falta
//   node api/scripts/migrate.js              aplicar todo lo pendiente
//   node api/scripts/migrate.js --baseline   marcar TODO lo existente como
//                                            aplicado, sin ejecutarlo
//
// `--baseline` es para adoptar el runner en una base que ya venía migrada a
// mano: registra los archivos actuales como aplicados para que no se vuelvan
// a correr. Hay que usarlo UNA sola vez, al empezar a usar este script.
//
// Nota sobre transacciones: cada archivo trae su propio BEGIN/COMMIT, así que
// el runner lo manda tal cual y anota el registro después. Si un archivo se
// aplica pero falla el registro, el script lo grita para que se corrija a
// mano — es preferible a reescribir el SQL del archivo.
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");

const DIR_MIGRACIONES = path.join(__dirname, "..", "migrations");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "gimnasio",
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

const SQL_TABLA = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    nombre      TEXT PRIMARY KEY,
    aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

function archivosMigracion() {
  if (!fs.existsSync(DIR_MIGRACIONES)) return [];
  return fs
    .readdirSync(DIR_MIGRACIONES)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function aplicadas(client) {
  const r = await client.query("SELECT nombre FROM schema_migrations");
  return new Set(r.rows.map((x) => x.nombre));
}

async function main() {
  const modo = process.argv[2];
  const client = await pool.connect();
  try {
    await client.query(SQL_TABLA);
    const todas = archivosMigracion();
    const ya = await aplicadas(client);
    const pendientes = todas.filter((f) => !ya.has(f));

    console.log(`Base: ${process.env.DB_NAME || "gimnasio"}`);
    console.log(`Migraciones: ${todas.length} en disco, ${ya.size} aplicadas.\n`);

    if (modo === "--status") {
      for (const f of todas) {
        console.log(`  ${ya.has(f) ? "[aplicada]" : "[PENDIENTE]"} ${f}`);
      }
      const huerfanas = [...ya].filter((n) => !todas.includes(n));
      if (huerfanas.length) {
        console.log(
          `\n⚠  Registradas pero sin archivo en disco: ${huerfanas.join(", ")}`
        );
      }
      return;
    }

    if (modo === "--baseline") {
      if (!pendientes.length) {
        console.log("Nada para marcar: todo ya está registrado.");
        return;
      }
      for (const f of pendientes) {
        await client.query(
          "INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING",
          [f]
        );
        console.log(`  marcada como aplicada (sin ejecutar): ${f}`);
      }
      console.log(
        `\n${pendientes.length} migración(es) registradas. ` +
          "De acá en adelante usar el script sin flags."
      );
      return;
    }

    if (!pendientes.length) {
      console.log("Todo al día, no hay migraciones pendientes.");
      return;
    }

    for (const f of pendientes) {
      const sql = fs.readFileSync(path.join(DIR_MIGRACIONES, f), "utf8");
      process.stdout.write(`  aplicando ${f} … `);
      try {
        await client.query(sql);
      } catch (e) {
        console.log("FALLÓ");
        console.error(`\n✖ ${f}: ${e.message}`);
        console.error("Se detiene acá; las anteriores quedaron aplicadas.");
        process.exitCode = 1;
        return;
      }
      try {
        await client.query(
          "INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING",
          [f]
        );
      } catch (e) {
        console.log("APLICADA PERO NO REGISTRADA");
        console.error(
          `\n✖ ${f} se aplicó pero no se pudo registrar: ${e.message}\n` +
            `   Registrala a mano para que no se vuelva a correr:\n` +
            `   INSERT INTO schema_migrations (nombre) VALUES ('${f}');`
        );
        process.exitCode = 1;
        return;
      }
      console.log("OK");
    }
    console.log(`\n${pendientes.length} migración(es) aplicadas.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exitCode = 1;
});
