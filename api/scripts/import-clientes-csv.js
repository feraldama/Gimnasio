// Importa clientes desde el CSV del sistema anterior a la base PostgreSQL.
//
// El CSV NO tiene encabezado y trae 14 columnas del sistema viejo. Mapeo:
//   col1  -> clienteruc (cedula)   | se calcula clientedv (modulo 11 SET)
//   col2  -> clientenombre
//   col3  -> clienteapellido
//   col4  -> clientetelefono       | "0" => vacio
//   col5  -> clientedireccion      | "-" => vacio
//   col6  -> (descartado, siempre "-")
//   col7  -> (descartado, flag activo t/f)
//   col8  -> (descartado, tipo del sistema viejo)
//   col9  -> normalmente "0"; en filas sucias trae CI-DV o la fecha de nac.
//   col10 -> clientefechanacimiento | vacio => 1900-01-01
//   col11 -> (descartado, fecha de alta vieja)
//   col12 -> (descartado, siempre "1")
//   col13 -> clientesexo           | normalizado a f/m
//   col14 -> (descartado)
//
// clientetipo se fija en 'MI'. Los clienteid son autogenerados (no se
// conservan los del sistema viejo porque el CSV no los trae).
//
// Deduplicacion / matching:
//   - Dentro del CSV: por cedula (clienteruc). El CSV no tiene cedulas
//     repetidas, asi que cada fila es una persona distinta aunque dos
//     compartan nombre+apellido.
//   - Contra la base: si la cedula ya existe -> se salta (idempotente). Si NO
//     hay cedula pero el nombre+apellido coincide con un cliente existente
//     (tipicamente cargado antes SIN cedula), se ENRIQUECE ese registro con
//     cedula/DV/telefono/direccion/nacimiento/sexo en vez de duplicarlo.
//
// Uso:
//   node api/scripts/import-clientes-csv.js --file=RUTA          # dry-run
//   node api/scripts/import-clientes-csv.js --file=RUTA --apply  # escribe
//
// Lee la conexion de api/.env.

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");
const { calcularDV } = require("../utils/rucDv");

const APPLY = process.argv.includes("--apply");
const fileArg = process.argv.find((a) => a.startsWith("--file="));
if (!fileArg) {
  console.error("Falta --file=RUTA_AL_CSV");
  process.exit(1);
}
const CSV_PATH = fileArg.slice("--file=".length);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s) => (s == null ? "" : String(s).trim());
const key = (nombre, apellido) =>
  `${norm(nombre).toUpperCase()}|${norm(apellido).toUpperCase()}`;

// Parser CSV minimalista: soporta campos entre comillas dobles (con "" como
// comilla escapada). El archivo usa , como separador y \r\n o \n como fin.
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignorar; el \n cierra la fila
    } else {
      field += ch;
    }
  }
  // ultima fila si el archivo no termina en salto de linea
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // descartar filas totalmente vacias
  return rows.filter((r) => r.some((c) => norm(c) !== ""));
}

// Convierte una fila cruda del CSV al registro de cliente destino, o null si
// debe descartarse (placeholder de venta).
function mapRow(cols) {
  const cedula = norm(cols[0]);
  const nombre = norm(cols[1]);
  const apellido = norm(cols[2]);

  // Placeholder de POS ("0,VENTA DE SALON,..."): no es un cliente real.
  if (cedula === "0" || cedula === "") return null;

  let telefono = norm(cols[3]);
  if (telefono === "0") telefono = "";

  let direccion = norm(cols[4]);
  if (direccion === "-") direccion = "";

  // Fecha de nacimiento: normalmente col10. En la fila corrida (col9 es una
  // fecha) la fecha de nacimiento quedo en col9.
  const col9 = norm(cols[8]);
  let fechanac = norm(cols[9]);
  if (DATE_RE.test(col9)) fechanac = col9;
  if (!DATE_RE.test(fechanac)) fechanac = "1900-01-01";

  let sexo = norm(cols[12]).toLowerCase();
  if (sexo !== "f" && sexo !== "m") sexo = "";

  const dv = String(calcularDV(cedula));

  return {
    clienteruc: cedula,
    clientedv: dv,
    clientenombre: nombre,
    clienteapellido: apellido,
    clientedireccion: direccion,
    clientetelefono: telefono,
    clientetipo: "MI",
    clientefechanacimiento: fechanac,
    clientesexo: sexo,
  };
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("No se encontro el CSV:", CSV_PATH);
    process.exit(1);
  }
  console.log("CSV:", CSV_PATH);
  console.log("Modo:", APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)");

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rawRows = parseCsv(text);
  console.log(`\nFilas leidas del CSV: ${rawRows.length}`);

  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "gimnasio",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
  });
  const client = await pool.connect();
  try {
    // Verificar que exista la columna clientesexo (migracion 016).
    const colCheck = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name='clientes' AND column_name='clientesexo'`
    );
    if (colCheck.rowCount === 0) {
      console.error(
        "\nFalta la columna clientesexo. Corre primero:\n" +
          "  node api/scripts/run-migration.js 016-cliente-sexo.sql"
      );
      process.exit(1);
    }

    // Estado actual de la base para dedup/matching.
    const existing = await client.query(
      `SELECT clienteid, clienteruc, clientenombre, clienteapellido,
              clientetelefono, clientedireccion, clientefechanacimiento
         FROM clientes`
    );
    const rucExistentes = new Set(
      existing.rows.map((r) => norm(r.clienteruc)).filter((v) => v !== "")
    );
    // Nombre+apellido -> registro existente (para enriquecer). Si un mismo
    // nombre aparece en varios registros existentes, nos quedamos con el 1ro.
    const porNombre = new Map();
    for (const r of existing.rows) {
      const k = key(r.clientenombre, r.clienteapellido);
      if (!porNombre.has(k)) porNombre.set(k, r);
    }

    const aInsertar = [];
    const aEnriquecer = []; // { id, c }
    const cedulasVistas = new Set();
    const idsEnriquecidos = new Set();
    let descartadosPlaceholder = 0;
    let dupCedulaExistente = 0;
    let dupDentroCsv = 0;

    for (const cols of rawRows) {
      const c = mapRow(cols);
      if (c === null) {
        descartadosPlaceholder++;
        continue;
      }
      // Dedup interno por cedula.
      if (cedulasVistas.has(c.clienteruc)) {
        dupDentroCsv++;
        continue;
      }
      cedulasVistas.add(c.clienteruc);

      // Ya cargado en una corrida previa (misma cedula en la base).
      if (rucExistentes.has(c.clienteruc)) {
        dupCedulaExistente++;
        continue;
      }

      // Coincide por nombre con un existente SIN cedula -> enriquecer (una vez).
      const k = key(c.clientenombre, c.clienteapellido);
      const match = porNombre.get(k);
      if (match && !idsEnriquecidos.has(match.clienteid)) {
        idsEnriquecidos.add(match.clienteid);
        aEnriquecer.push({ id: match.clienteid, actual: match, c });
        continue;
      }

      aInsertar.push(c);
    }

    console.log("\n--- Resumen ---");
    console.log(`  Nuevos a insertar:               ${aInsertar.length}`);
    console.log(`  Existentes a enriquecer:         ${aEnriquecer.length}`);
    console.log(`  Descartados (placeholder POS):   ${descartadosPlaceholder}`);
    console.log(`  Saltados (cedula ya en la base): ${dupCedulaExistente}`);
    console.log(`  Saltados (cedula dup en CSV):    ${dupDentroCsv}`);

    console.log("\n--- Muestra nuevos (primeros 5) ---");
    for (const c of aInsertar.slice(0, 5)) {
      console.log(
        `  ${c.clienteruc}-${c.clientedv} | ${c.clientenombre} ${c.clienteapellido} | ` +
          `tel=${c.clientetelefono || "-"} | nac=${c.clientefechanacimiento} | sexo=${c.clientesexo || "-"}`
      );
    }
    console.log("\n--- A enriquecer ---");
    for (const e of aEnriquecer) {
      console.log(
        `  #${e.id} "${e.c.clientenombre} ${e.c.clienteapellido}" <- ced ${e.c.clienteruc}-${e.c.clientedv}, sexo=${e.c.clientesexo || "-"}`
      );
    }
    const sinNac = aInsertar.filter(
      (c) => c.clientefechanacimiento === "1900-01-01"
    ).length;
    console.log(`\n  Nuevos sin fecha de nacimiento (1900-01-01): ${sinNac}`);

    if (!APPLY) {
      console.log("\nDRY-RUN ok. Nada se escribio. Corre con --apply para cargar.");
      return;
    }

    console.log("\n--- Aplicando (transaccion) ---");
    await client.query("BEGIN");
    const cols = [
      "clienteruc",
      "clientedv",
      "clientenombre",
      "clienteapellido",
      "clientedireccion",
      "clientetelefono",
      "clientetipo",
      "clientefechanacimiento",
      "clientesexo",
    ];
    const colList = cols.join(", ");
    const ph = cols.map((_, k) => "$" + (k + 1)).join(", ");
    let n = 0;
    for (const c of aInsertar) {
      await client.query(
        `INSERT INTO clientes (${colList}) VALUES (${ph})`,
        cols.map((name) => c[name])
      );
      n++;
    }

    // Enriquecer existentes: seteamos cedula/DV/sexo siempre; telefono,
    // direccion y nacimiento solo si el CSV aporta un valor (no pisamos con
    // vacio/default lo que el registro ya tuviera).
    let m = 0;
    for (const e of aEnriquecer) {
      const c = e.c;
      const telefono = c.clientetelefono || norm(e.actual.clientetelefono);
      const direccion = c.clientedireccion || norm(e.actual.clientedireccion);
      const nacimiento =
        c.clientefechanacimiento !== "1900-01-01"
          ? c.clientefechanacimiento
          : e.actual.clientefechanacimiento;
      await client.query(
        `UPDATE clientes
            SET clienteruc = $1, clientedv = $2, clientetelefono = $3,
                clientedireccion = $4, clientefechanacimiento = $5,
                clientesexo = $6
          WHERE clienteid = $7`,
        [c.clienteruc, c.clientedv, telefono, direccion, nacimiento, c.clientesexo, e.id]
      );
      m++;
    }

    // Resincronizar la secuencia del PK con el MAX insertado.
    await client.query(
      "SELECT setval('clientes_clienteid_seq', (SELECT COALESCE(MAX(clienteid),1) FROM clientes))"
    );
    await client.query("COMMIT");
    console.log(`\nImport COMMIT ok. Insertados: ${n} | Enriquecidos: ${m}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nERROR, ROLLBACK:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
