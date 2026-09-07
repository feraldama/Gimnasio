// Apertura y cierre de caja contra la base: verifica que el registro contable
// y el movimiento del monto ocurran juntos o no ocurran.
//
// El bug que motivó esto: el cierre hacía `UPDATE Caja SET CajaMonto = 0` y
// DESPUÉS el INSERT del registro, sin transacción. Si el INSERT fallaba, el
// cajón quedaba en cero sin registro de cierre; y como el estado de la caja se
// deduce de la existencia de ese registro, el sistema seguía diciendo "CAJA
// ABIERTA" con el monto ya borrado.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
//
// Apuntar DB_NAME a una copia, no a la base de producción del gimnasio.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

describe(
  "caja: apertura y cierre transaccional",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, RegistroDiarioCaja, usuarioId;
    let cajaId = null;

    const q = (sql, params) =>
      new Promise((res, rej) =>
        db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r)))
      );

    before(async () => {
      db = require("../../config/db");
      RegistroDiarioCaja = require("../../models/registrodiariocaja.model");

      // UsuarioId es FK: se reutiliza uno existente en vez de crear usuarios.
      const u = await q("SELECT UsuarioId FROM usuario LIMIT 1");
      assert.ok(u.length, "la base necesita al menos un usuario para este test");
      usuarioId = u[0].UsuarioId;

      const c = await q(
        `INSERT INTO caja (CajaDescripcion, CajaMonto) VALUES ('TEST-CAJA', 0)`
      );
      cajaId = c.insertId;
    });

    after(async () => {
      if (!db) return;
      try {
        if (cajaId) {
          await q("DELETE FROM registrodiariocaja WHERE CajaId = ?", [cajaId]);
          await q("DELETE FROM caja WHERE CajaId = ?", [cajaId]);
        }
      } finally {
        await db.end();
      }
    });

    const montoCaja = async () =>
      Number((await q("SELECT CajaMonto AS m FROM caja WHERE CajaId = ?", [cajaId]))[0].m);

    const cantidadRegistros = async () =>
      Number(
        (
          await q(
            "SELECT COUNT(*) AS n FROM registrodiariocaja WHERE CajaId = ?",
            [cajaId]
          )
        )[0].n
      );

    const operar = (esApertura, monto) =>
      RegistroDiarioCaja.aperturaCierreTransaccional({
        esApertura,
        cajaId,
        monto,
        usuarioId,
        cajaDescripcion: "TEST-CAJA",
      });

    test("la apertura suma el monto al cajón y deja registro", async () => {
      const registrosAntes = await cantidadRegistros();
      await operar(true, 150000);
      assert.equal(await montoCaja(), 150000);
      assert.equal(await cantidadRegistros(), registrosAntes + 1);
    });

    test("la apertura queda detectable como última apertura", async () => {
      const ap = await RegistroDiarioCaja.getUltimaApertura(cajaId);
      assert.ok(ap, "getUltimaApertura debe encontrar el registro");
      assert.equal(Number(ap.RegistroDiarioCajaMonto), 150000);
      assert.match(ap.RegistroDiarioCajaDetalle, /^APERTURA/);
    });

    test("el cierre pone el cajón en cero y deja registro", async () => {
      const registrosAntes = await cantidadRegistros();
      await operar(false, 175000);
      assert.equal(await montoCaja(), 0);
      assert.equal(await cantidadRegistros(), registrosAntes + 1);
      const ci = await RegistroDiarioCaja.getUltimoCierre(cajaId);
      assert.ok(ci);
      assert.match(ci.RegistroDiarioCajaDetalle, /^CIERRE/);
    });

    test("tras el cierre, el id de cierre supera al de apertura", async () => {
      // Es lo que `evaluarAperturaCierre` usa para saber que está cerrada.
      const ap = await RegistroDiarioCaja.getUltimaApertura(cajaId);
      const ci = await RegistroDiarioCaja.getUltimoCierre(cajaId);
      assert.ok(
        ci.RegistroDiarioCajaId > ap.RegistroDiarioCajaId,
        "el cierre debe ser posterior a la apertura"
      );
    });

    test("si falla el registro, el monto del cajón NO se toca (rollback)", async () => {
      // Es el caso del bug. Se fuerza el fallo del INSERT con un UsuarioId
      // más largo que la columna (error 22001). Cualquier fallo del registro
      // sirve; lo que importa es que ocurra DESPUÉS de que el monto ya se
      // habría movido en la versión anterior.
      //
      // Verificado reproduciendo la secuencia vieja (UPDATE a cero y luego
      // INSERT, sin transacción): el cajón quedaba en 0 y sin registro de
      // cierre, o sea Gs. 90.000 fuera del sistema sin rastro.
      await operar(true, 90000);
      const montoAntes = await montoCaja();
      const registrosAntes = await cantidadRegistros();
      assert.equal(montoAntes, 90000);

      await assert.rejects(() =>
        RegistroDiarioCaja.aperturaCierreTransaccional({
          esApertura: false,
          cajaId,
          monto: 90000,
          usuarioId: "USUARIO-QUE-NO-EXISTE-EN-LA-FK",
          cajaDescripcion: "TEST-CAJA",
        })
      );

      assert.equal(
        await montoCaja(),
        montoAntes,
        "el cajón no puede haber quedado en cero si no se registró el cierre"
      );
      assert.equal(
        await cantidadRegistros(),
        registrosAntes,
        "no debe quedar ningún registro a medias"
      );
    });

    test("la caja sigue operable después del fallo", async () => {
      // Cerrar de verdad tiene que funcionar: el estado no quedó corrupto.
      await operar(false, 90000);
      assert.equal(await montoCaja(), 0);
      const ap = await RegistroDiarioCaja.getUltimaApertura(cajaId);
      const ci = await RegistroDiarioCaja.getUltimoCierre(cajaId);
      assert.ok(ci.RegistroDiarioCajaId > ap.RegistroDiarioCajaId);
    });

    test("aperturas sucesivas acumulan sobre el monto existente", async () => {
      // `CajaMonto = CajaMonto + ?` es acumulativo; lo que impide sumar dos
      // veces la apertura de un mismo turno es la regla de
      // evaluarAperturaCierre, no el modelo.
      await operar(true, 50000);
      assert.equal(await montoCaja(), 50000);
      await operar(false, 50000);
      await operar(true, 30000);
      assert.equal(await montoCaja(), 30000);
      await operar(false, 30000);
    });
  }
);
