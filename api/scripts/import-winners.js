// Importa los datos maestros del backup viejo (winners.sql, dump phpMyAdmin /
// MariaDB) a la base PostgreSQL del sistema nuevo, CONSERVANDO los IDs
// originales. Pensado para resetear una base dev: vacía las tablas maestras y
// transaccionales y recarga winners.
//
// Tablas que importa (en orden de dependencia de FKs):
//   usuario  ->  usuarioperfil  ->  clientes  ->  producto  ->  productoalmacen
//
// El dump es MySQL: identificadores con backticks y strings con escapes estilo
// MySQL (\' \" \\ \n ...). Como el adaptador PG del proyecto guarda las columnas
// en minúscula, las columnas PascalCase del dump matchean al insertarlas en
// minúscula. Para evitar líos de escaping, NO traducimos SQL: parseamos los
// valores a JS y cargamos con queries parametrizadas.
//
// Uso:
//   node api/scripts/import-winners.js            # dry-run (no escribe nada)
//   node api/scripts/import-winners.js --apply     # vacía dev y carga winners
//
// Lee la conexión de api/.env y el dump de <repo>/winners.sql (o --file=ruta).

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const DUMP_PATH = fileArg
  ? fileArg.slice("--file=".length)
  : path.join(__dirname, "..", "..", "winners.sql");

// --- Parser del dump --------------------------------------------------------

// Mapeo de escapes MySQL dentro de strings.
const ESC = { n: "\n", r: "\r", t: "\t", "0": "\0", b: "\b", Z: "\x1a" };

// Parsea un string literal MySQL que empieza en sql[i] === "'".
// Devuelve { value, next } con next apuntando después de la comilla de cierre.
function parseString(sql, i) {
  let out = "";
  i++; // saltar comilla inicial
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "\\") {
      const n = sql[i + 1];
      out += ESC[n] !== undefined ? ESC[n] : n;
      i += 2;
    } else if (ch === "'") {
      if (sql[i + 1] === "'") {
        // comilla escapada por duplicación
        out += "'";
        i += 2;
      } else {
        return { value: out, next: i + 1 };
      }
    } else {
      out += ch;
      i++;
    }
  }
  throw new Error("String sin cerrar en el dump");
}

// Parsea una tupla ( v1, v2, ... ) que empieza en sql[i] === "(".
// Devuelve { row: [valores], next }. Cada valor es string | number-string | null.
function parseTuple(sql, i) {
  const row = [];
  i++; // saltar '('
  while (i < sql.length) {
    while (/\s/.test(sql[i])) i++;
    const ch = sql[i];
    if (ch === ")") return { row, next: i + 1 };
    if (ch === "'") {
      const r = parseString(sql, i);
      row.push(r.value);
      i = r.next;
    } else {
      // token sin comillas hasta ',' o ')'
      let tok = "";
      while (i < sql.length && sql[i] !== "," && sql[i] !== ")") {
        tok += sql[i];
        i++;
      }
      tok = tok.trim();
      row.push(/^null$/i.test(tok) ? null : tok);
    }
    while (/\s/.test(sql[i])) i++;
    if (sql[i] === ",") i++;
  }
  throw new Error("Tupla sin cerrar en el dump");
}

// Extrae { columns, rows } de TODOS los INSERT INTO `table` del dump.
// El backtick de cierre del nombre evita que `producto` matchee a
// `productoalmacen` o `compraproducto`.
function extractTable(sql, table) {
  const marker = "INSERT INTO `" + table + "`";
  let columns = null;
  const rows = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf(marker, from);
    if (start === -1) break;
    // lista de columnas: entre el primer '(' y su ')' tras el marker
    const colOpen = sql.indexOf("(", start + marker.length);
    const colClose = sql.indexOf(")", colOpen);
    const cols = sql
      .slice(colOpen + 1, colClose)
      .split(",")
      .map((c) => c.replace(/`/g, "").trim().toLowerCase());
    if (!columns) columns = cols;
    // cuerpo VALUES
    let i = sql.indexOf("VALUES", colClose);
    i += "VALUES".length;
    for (;;) {
      while (/\s/.test(sql[i])) i++;
      if (sql[i] === "(") {
        const t = parseTuple(sql, i);
        rows.push(t.row);
        i = t.next;
        while (/\s/.test(sql[i])) i++;
        if (sql[i] === ",") {
          i++;
          continue;
        }
      }
      break; // ';' o fin del statement
    }
    from = i;
  }
  if (!columns) return null;
  return { columns, rows };
}

// --- Helpers de carga -------------------------------------------------------

// Convierte el valor de una columna bytea a Buffer. En el dump las imágenes
// vienen como literal hex de MySQL (0xFFD8...); las demás como '' (string vacío).
function toBytea(v) {
  if (v == null) return Buffer.alloc(0);
  const s = String(v);
  if (/^0x[0-9a-fA-F]*$/.test(s)) return Buffer.from(s.slice(2), "hex");
  return Buffer.from(s, "utf8");
}

// Inserta filas con query parametrizada. byteaCols => esas columnas se mandan
// como Buffer. Devuelve cantidad insertada.
async function insertRows(client, table, columns, rows, opts = {}) {
  const byteaCols = new Set(opts.byteaCols || []);
  const colList = columns.join(", ");
  let count = 0;
  for (const row of rows) {
    const params = row.map((v, idx) => {
      if (byteaCols.has(columns[idx])) {
        return toBytea(v);
      }
      return v;
    });
    const ph = params.map((_, k) => "$" + (k + 1)).join(", ");
    await client.query(
      `INSERT INTO ${table} (${colList}) VALUES (${ph})`,
      params
    );
    count++;
  }
  return count;
}

async function main() {
  if (!fs.existsSync(DUMP_PATH)) {
    console.error("No se encontró el dump:", DUMP_PATH);
    process.exit(1);
  }
  console.log("Dump:", DUMP_PATH);
  console.log("Modo:", APPLY ? "APPLY (vacía y carga)" : "DRY-RUN (no escribe)");
  const sql = fs.readFileSync(DUMP_PATH, "utf8");

  const usuario = extractTable(sql, "usuario");
  const usuarioperfil = extractTable(sql, "usuarioperfil");
  const clientes = extractTable(sql, "clientes");
  const producto = extractTable(sql, "producto");
  const productoalmacen = extractTable(sql, "productoalmacen");

  const tablas = { usuario, usuarioperfil, clientes, producto, productoalmacen };
  console.log("\n--- Parseado del dump ---");
  for (const [name, t] of Object.entries(tablas)) {
    if (!t) {
      console.log(`  ${name}: NO ENCONTRADO`);
      continue;
    }
    console.log(`  ${name}: ${t.rows.length} filas | cols: ${t.columns.join(", ")}`);
  }

  // Chequeo: imágenes de producto no vacías (van a bytea).
  const imgIdx = producto.columns.indexOf("productoimagen");
  const imgsNoVacias = producto.rows.filter(
    (r) => r[imgIdx] != null && String(r[imgIdx]).length > 0
  ).length;
  console.log(`  (producto: ${imgsNoVacias} imágenes binarias no vacías)`);

  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "gimnasio",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
  });
  const client = await pool.connect();
  try {
    // Set de usuarios y perfiles válidos para filtrar FKs colgadas.
    const usuarioIds = new Set(
      usuario.rows.map((r) => r[usuario.columns.indexOf("usuarioid")])
    );
    const perfilRes = await client.query("SELECT perfilid FROM perfil");
    const perfilIds = new Set(perfilRes.rows.map((r) => String(r.perfilid)));

    // clientes con usuarioid que NO existe en winners.usuario -> se pondrá NULL.
    const cliUserIdx = clientes.columns.indexOf("usuarioid");
    const cliDangling = clientes.rows.filter(
      (r) => r[cliUserIdx] != null && !usuarioIds.has(r[cliUserIdx])
    ).length;
    console.log(
      `  clientes con usuarioid inexistente (se setean NULL): ${cliDangling}`
    );

    // usuarioperfil filtrado a perfiles existentes en destino.
    const upUserIdx = usuarioperfil.columns.indexOf("usuarioid");
    const upPerfIdx = usuarioperfil.columns.indexOf("perfilid");
    const upValidas = usuarioperfil.rows.filter(
      (r) => usuarioIds.has(r[upUserIdx]) && perfilIds.has(String(r[upPerfIdx]))
    );
    console.log(
      `  usuarioperfil válidas (usuario+perfil existen): ${upValidas.length} de ${usuarioperfil.rows.length}`
    );

    if (!APPLY) {
      console.log("\nDRY-RUN ok. Nada se escribió. Corré con --apply para cargar.");
      return;
    }

    console.log("\n--- Aplicando (transacción) ---");
    await client.query("BEGIN");

    // Vaciar dev. CASCADE arrastra todas las tablas que referencian a estas.
    console.log("  Vaciando tablas (TRUNCATE CASCADE)...");
    await client.query(
      `TRUNCATE TABLE usuario, usuarioperfil, clientes, producto, productoalmacen
       RESTART IDENTITY CASCADE`
    );

    // Cargar en orden de dependencia.
    const nU = await insertRows(client, "usuario", usuario.columns, usuario.rows);
    console.log(`  usuario: ${nU}`);

    const nUP = await insertRows(
      client,
      "usuarioperfil",
      usuarioperfil.columns,
      upValidas
    );
    console.log(`  usuarioperfil: ${nUP}`);

    // clientes: null-ear usuarioid colgado antes de insertar.
    const cliRows = clientes.rows.map((r) => {
      const c = r.slice();
      if (c[cliUserIdx] != null && !usuarioIds.has(c[cliUserIdx]))
        c[cliUserIdx] = null;
      return c;
    });
    const nC = await insertRows(client, "clientes", clientes.columns, cliRows);
    console.log(`  clientes: ${nC}`);

    const nP = await insertRows(client, "producto", producto.columns, producto.rows, {
      byteaCols: ["productoimagen"],
    });
    console.log(`  producto: ${nP}`);

    // productoalmacen: solo filas cuyo productoid se importó.
    const prodIds = new Set(
      producto.rows.map((r) => String(r[producto.columns.indexOf("productoid")]))
    );
    const paProdIdx = productoalmacen.columns.indexOf("productoid");
    const paRows = productoalmacen.rows.filter((r) =>
      prodIds.has(String(r[paProdIdx]))
    );
    const nPA = await insertRows(
      client,
      "productoalmacen",
      productoalmacen.columns,
      paRows
    );
    console.log(`  productoalmacen: ${nPA} (de ${productoalmacen.rows.length})`);

    // CANCHA (1) y PELOTAS (2): marcarlos como servicio (precio editable, sin stock).
    const upd = await client.query(
      "UPDATE producto SET productoservicio = 1 WHERE productoid IN (1, 2)"
    );
    console.log(`  marcados como servicio (cancha/pelota): ${upd.rowCount}`);

    // Re-sincronizar las secuencias de los PK seriales con el MAX importado.
    await client.query(
      "SELECT setval('clientes_clienteid_seq', (SELECT COALESCE(MAX(clienteid),1) FROM clientes))"
    );
    await client.query(
      "SELECT setval('producto_productoid_seq', (SELECT COALESCE(MAX(productoid),1) FROM producto))"
    );
    console.log("  secuencias clientes/producto re-sincronizadas");

    await client.query("COMMIT");
    console.log("\nImport COMMIT ok.");
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
