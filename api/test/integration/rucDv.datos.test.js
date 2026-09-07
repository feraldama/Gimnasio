// Cruce del algoritmo de DV contra los datos reales importados del sistema
// anterior. Es la validación más fuerte que se puede hacer del módulo 11: los
// DV de la base los calculó otro sistema, así que si coinciden, el algoritmo
// reproduce el del software que el gimnasio venía usando (y por lo tanto el de
// las facturas ya emitidas).
//
// Sólo lee, no escribe nada.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

describe(
  "DV contra los datos importados",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, calcularDV, filas;

    before(async () => {
      db = require("../../config/db");
      ({ calcularDV } = require("../../utils/rucDv"));
      filas = await new Promise((res, rej) =>
        db.query(
          `SELECT ClienteRUC, ClienteDV FROM clientes
           WHERE TRIM(ClienteRUC) <> '' AND TRIM(COALESCE(ClienteDV, '')) <> ''`,
          [],
          (e, r) => (e ? rej(e) : res(r))
        )
      );
    });

    after(async () => {
      if (db) await db.end();
    });

    test("hay datos para cruzar", () => {
      assert.ok(
        filas.length > 0,
        "no hay clientes con RUC y DV cargados; el cruce no prueba nada"
      );
    });

    test("el DV calculado coincide con el del sistema anterior", () => {
      const distintos = [];
      for (const f of filas) {
        const calculado = String(calcularDV(f.ClienteRUC));
        if (calculado !== String(f.ClienteDV).trim()) {
          distintos.push(`${f.ClienteRUC}: base=${f.ClienteDV} calculado=${calculado}`);
        }
      }
      assert.deepEqual(
        distintos,
        [],
        `${distintos.length} de ${filas.length} DV no coinciden`
      );
    });
  }
);
