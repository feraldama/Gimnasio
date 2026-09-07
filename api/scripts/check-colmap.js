// Verifica que `config/columnMap.js` cubra todas las columnas de la base.
//
// Por qué importa: el adaptador de Postgres (config/db.js) usa ese mapa para
// devolver los nombres de columna en PascalCase, que es como los espera el
// frontend. Una columna que falte en el mapa NO da error: viaja en minúsculas
// y el frontend la lee como `undefined`. Eso ya pasó con `clientesexo`
// (migración 016), que quedó fuera del mapa.
//
// El encabezado de columnMap.js dice que lo genera `migration/gen_colmap.js`,
// pero ese script no está en el repo, así que el mapa se mantiene a mano y
// conviene verificarlo después de cada migración que agregue columnas.
//
// Uso:
//   node api/scripts/check-colmap.js
//
// Sale con código 1 si falta alguna, así que sirve para un hook o para CI.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");
const { columnNameByLower } = require("../config/columnMap");

// Tablas del sistema que no forman parte del modelo de la app.
const TABLAS_IGNORADAS = new Set(["schema_migrations"]);

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "gimnasio",
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

(async () => {
  try {
    const { rows } = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name
    `);
    const faltantes = [];
    for (const r of rows) {
      if (TABLAS_IGNORADAS.has(r.table_name)) continue;
      if (!columnNameByLower[r.column_name]) {
        faltantes.push(`${r.table_name}.${r.column_name}`);
      }
    }
    const total = rows.length;
    if (!faltantes.length) {
      console.log(
        `OK: las ${total} columnas de la base están en columnMap.js.`
      );
      return;
    }
    console.error(
      `✖ ${faltantes.length} columna(s) sin entrada en config/columnMap.js:\n`
    );
    for (const f of faltantes) console.error(`   ${f}`);
    console.error(
      "\nEstas columnas viajan en minúsculas al frontend (que espera " +
        "PascalCase) y se leen como undefined, sin ningún error visible.\n" +
        'Agregar en columnMap.js: "columna": "NombrePascalCase".'
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error("Error:", e.message);
  process.exitCode = 1;
});
