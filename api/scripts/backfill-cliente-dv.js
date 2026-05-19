// Backfill de ClienteDV para los clientes existentes.
//
//   - Si ClienteRUC tiene formato "CI-DV": split y guardamos cada parte.
//   - Si ClienteRUC tiene solo digitos: calculamos el DV con el modulo 11.
//   - Si ClienteRUC esta vacio: dejamos DV vacio.
//
// Idempotente: respeta valores ya guardados en ClienteDV (no pisa los que ya
// tienen DV). Para forzar recalculo de todos, pasar --force.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");
const { calcularDV } = require("../utils/rucDv");

const force = process.argv.includes("--force");

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT, 10),
});

(async () => {
  const client = await pool.connect();
  try {
    const rows = await client.query(
      "SELECT clienteid, clienteruc, clientedv FROM clientes ORDER BY clienteid"
    );
    let actualizados = 0;
    let saltados = 0;
    let sinRUC = 0;

    for (const r of rows.rows) {
      const id = r.clienteid;
      const rucOriginal = (r.clienteruc || "").trim();
      const dvActual = (r.clientedv || "").trim();

      if (!rucOriginal) {
        sinRUC++;
        continue;
      }
      if (dvActual && !force) {
        saltados++;
        continue;
      }

      let nuevoRuc = rucOriginal;
      let nuevoDV = "";

      // Caso 1: viene con guion "CI-DV" → split.
      const guion = rucOriginal.indexOf("-");
      if (guion >= 0) {
        nuevoRuc = rucOriginal.slice(0, guion).trim();
        nuevoDV = rucOriginal.slice(guion + 1).trim();
      } else {
        // Caso 2: solo CI → calculamos DV.
        nuevoDV = String(calcularDV(rucOriginal));
      }

      await client.query(
        "UPDATE clientes SET clienteruc = $1, clientedv = $2 WHERE clienteid = $3",
        [nuevoRuc, nuevoDV, id]
      );
      console.log(
        `#${id}: ${rucOriginal.padEnd(15)} -> RUC=${nuevoRuc} DV=${nuevoDV}`
      );
      actualizados++;
    }

    console.log("\nResumen:");
    console.log(`  Actualizados: ${actualizados}`);
    console.log(`  Saltados (ya tenian DV): ${saltados}`);
    console.log(`  Sin RUC: ${sinRUC}`);
  } catch (e) {
    console.error("Error:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
