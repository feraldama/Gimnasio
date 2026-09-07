// Selección de tarifa por banda horaria. Es lo que define cuánto se le cobra
// al cliente por la reserva, así que un error acá se cobra mal, todos los días.
//
// La lógica vive en el SQL de `bandaAplicable` (día de semana con LIKE, rango
// horario con <= y >, desempate por prioridad), y por eso necesita base.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
//
// Apuntar DB_NAME a una copia, no a la base de producción del gimnasio.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

describe(
  "cancha: tarifa aplicable por banda",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, CanchaTarifa;
    let canchaId = null;

    // Fechas fijas de 2026 con día de semana conocido.
    const LUNES = "2026-09-07";
    const SABADO = "2026-09-12";
    const DOMINGO = "2026-09-13";

    const q = (sql, params) =>
      new Promise((res, rej) =>
        db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r)))
      );

    const nuevaBanda = (nombre, dias, desde, hasta, precio, prioridad = 0, activa = 1) =>
      q(
        `INSERT INTO cancha_tarifa (CanchaId, CanchaTarifaNombre, CanchaTarifaDiasSemana,
             CanchaTarifaHoraDesde, CanchaTarifaHoraHasta, CanchaTarifaPrecio,
             CanchaTarifaPrioridad, CanchaTarifaActiva)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [canchaId, nombre, dias, desde, hasta, precio, prioridad, activa]
      );

    before(async () => {
      db = require("../../config/db");
      ({ CanchaTarifa } = require("../../models/canchaTarifa.model"));

      const c = await q(
        `INSERT INTO cancha (CanchaNombre, CanchaTarifaHora, CanchaActiva)
         VALUES ('TEST-TARIFA', 40000, 1)`
      );
      canchaId = c.insertId;

      // Escenario del ejemplo que documenta la migración 006.
      await nuevaBanda("dia habil", "L,M,X,J,V", "06:00", "18:00", 50000);
      await nuevaBanda("noche habil", "L,M,X,J,V", "18:00", "23:00", 80000);
      await nuevaBanda("fin de semana", "S,D", "06:00", "23:00", 100000);
    });

    after(async () => {
      if (!db) return;
      try {
        if (canchaId) {
          await q("DELETE FROM cancha_tarifa WHERE CanchaId = ?", [canchaId]);
          await q("DELETE FROM cancha WHERE CanchaId = ?", [canchaId]);
        }
      } finally {
        await db.end();
      }
    });

    const precioEn = async (fecha, hora) => {
      const b = await CanchaTarifa.bandaAplicable(canchaId, fecha, hora);
      return b ? Number(b.CanchaTarifaPrecio) : null;
    };

    test("lunes a la mañana toma la banda de día hábil", async () => {
      assert.equal(await precioEn(LUNES, "10:00"), 50000);
    });

    test("lunes a la noche toma la banda nocturna", async () => {
      assert.equal(await precioEn(LUNES, "20:00"), 80000);
    });

    test("sábado y domingo toman la banda de fin de semana", async () => {
      assert.equal(await precioEn(SABADO, "10:00"), 100000);
      assert.equal(await precioEn(DOMINGO, "20:00"), 100000);
    });

    test("la hora de inicio es inclusiva", async () => {
      // A las 18:00 en punto ya se cobra tarifa nocturna.
      assert.equal(await precioEn(LUNES, "18:00"), 80000);
    });

    test("la hora de fin es exclusiva (no se solapan las bandas)", async () => {
      // 17:59 todavía es tarifa de día; si el fin fuera inclusivo, a las 18:00
      // matchearían las dos bandas y el precio dependería del desempate.
      assert.equal(await precioEn(LUNES, "17:59"), 50000);
    });

    test("fuera del horario de las bandas devuelve null", async () => {
      // El llamador cae al fallback `cancha.CanchaTarifaHora`.
      assert.equal(await precioEn(LUNES, "03:00"), null);
      assert.equal(await precioEn(LUNES, "23:00"), null);
    });

    test("el miércoles no matchea la banda del martes", async () => {
      // Chequea que la sigla X del miércoles no colisione con M de martes.
      await nuevaBanda("solo martes", "M", "06:00", "23:00", 12345, 5);
      const miercoles = "2026-09-09";
      assert.notEqual(await precioEn(miercoles, "10:00"), 12345);
      assert.equal(await precioEn("2026-09-08", "10:00"), 12345, "martes sí");
      await q(
        "DELETE FROM cancha_tarifa WHERE CanchaId = ? AND CanchaTarifaNombre = 'solo martes'",
        [canchaId]
      );
    });

    test("ante dos bandas que matchean, gana la de mayor prioridad", async () => {
      // Caso de uso de la migración 006: una banda general más una excepción
      // (feriado, promoción) que debe pisarla.
      await nuevaBanda("excepcion", "L,M,X,J,V", "06:00", "18:00", 25000, 10);
      assert.equal(await precioEn(LUNES, "10:00"), 25000);
      await q(
        "DELETE FROM cancha_tarifa WHERE CanchaId = ? AND CanchaTarifaNombre = 'excepcion'",
        [canchaId]
      );
      assert.equal(
        await precioEn(LUNES, "10:00"),
        50000,
        "al quitar la excepción vuelve la banda general"
      );
    });

    test("una banda inactiva se ignora aunque matchee y tenga prioridad", async () => {
      await nuevaBanda("apagada", "L,M,X,J,V", "06:00", "18:00", 999, 99, 0);
      assert.equal(await precioEn(LUNES, "10:00"), 50000);
      await q(
        "DELETE FROM cancha_tarifa WHERE CanchaId = ? AND CanchaTarifaNombre = 'apagada'",
        [canchaId]
      );
    });

    test("las tarifas de otra cancha no se filtran", async () => {
      const otra = await q(
        `INSERT INTO cancha (CanchaNombre, CanchaTarifaHora, CanchaActiva)
         VALUES ('TEST-TARIFA-2', 0, 1)`
      );
      try {
        const b = await CanchaTarifa.bandaAplicable(otra.insertId, LUNES, "10:00");
        assert.equal(b, null, "la cancha nueva no tiene bandas propias");
      } finally {
        await q("DELETE FROM cancha WHERE CanchaId = ?", [otra.insertId]);
      }
    });

    test("acepta la fecha con timestamp y resuelve el día correcto", async () => {
      // El controlador puede pasar la fecha con la T; parsearla mal correría
      // el día de semana y cobraría la tarifa de otro día.
      assert.equal(await precioEn(`${SABADO}T00:00:00.000Z`, "10:00"), 100000);
    });
  }
);
