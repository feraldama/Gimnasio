// Reglas para cobrar sobre una suscripción existente.
//
// Es la última defensa antes de insertar un pago, y corre DENTRO de la
// transacción. El frontend (CrearPagoModal) ya no ofrece las canceladas ni
// las suspendidas en el combo, pero eso es comodidad para el mostrador: la
// regla que manda es ésta, porque el modal puede quedar abierto mientras otro
// usuario cancela la suscripción, y porque el endpoint también se puede
// llamar de afuera.
//
// La otra mitad —"no se permite saldo a favor"— es igual de importante: un
// pago de más sobre un plan deja plata sin imputar que después nadie sabe a
// qué corresponde.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// `pago.controller` arrastra `config/db`, que al cargarse abre el pool de
// Postgres y deja el proceso vivo 60 s (idleTimeoutMillis). Acá sólo se
// prueba la función de validación, a la que se le inyecta la conexión, así
// que ponemos un doble del módulo de base.
const rutaDb = require.resolve("../config/db");
require.cache[rutaDb] = {
  id: rutaDb,
  filename: rutaDb,
  loaded: true,
  exports: {
    query: () => {
      throw new Error("test unitario: no debe consultar la base");
    },
  },
};

const { validarCobroSuscripcion } = require("../controllers/pago.controller");

/**
 * Conexión falsa al estilo mysql2/promise: `query` devuelve `[rows]`.
 * `fila` null simula una suscripción inexistente.
 */
const conexionCon = (fila) => ({
  query: async () => [fila ? [fila] : []],
});

const suscripcion = (estado, planPrecio, totalPagado) => ({
  SuscripcionEstado: estado,
  PlanPrecio: planPrecio,
  TotalPagado: totalPagado,
});

describe("validarCobroSuscripcion", () => {
  test("rechaza la suscripción que no existe", async () => {
    const r = await validarCobroSuscripcion(conexionCon(null), 999, 50000);
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });

  test("no se cobra sobre una CANCELADA", async () => {
    const r = await validarCobroSuscripcion(
      conexionCon(suscripcion("C", 300000, 0)),
      1,
      300000
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.message, /cancelada o suspendida/);
  });

  test("no se cobra sobre una SUSPENDIDA", async () => {
    // Misma regla que la cancelada: por eso el combo del modal filtra las dos
    // y no sólo las canceladas.
    const r = await validarCobroSuscripcion(
      conexionCon(suscripcion("S", 300000, 0)),
      1,
      300000
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });

  test("el estado se chequea ANTES que el monto", async () => {
    // Una cancelada con un monto además excesivo tiene que reportar el estado,
    // que es la causa real. Si saliera el error de monto, el operador
    // corregiría el importe y volvería a chocar contra la misma pared.
    const r = await validarCobroSuscripcion(
      conexionCon(suscripcion("C", 100000, 90000)),
      1,
      999999
    );
    assert.equal(r.status, 409);
  });

  test("deja cobrar sobre activas, vencidas y futuras", async () => {
    // Vencida (V) tiene que poder cobrarse: es exactamente el socio que debe
    // el mes pasado y viene a ponerse al día.
    for (const estado of ["A", "V", "F"]) {
      const r = await validarCobroSuscripcion(
        conexionCon(suscripcion(estado, 300000, 0)),
        1,
        300000
      );
      assert.equal(r.ok, true, `estado ${estado} debería poder cobrarse`);
    }
  });

  test("acepta el pago exacto y el parcial", async () => {
    const exacto = await validarCobroSuscripcion(
      conexionCon(suscripcion("A", 300000, 0)),
      1,
      300000
    );
    assert.equal(exacto.ok, true);

    const parcial = await validarCobroSuscripcion(
      conexionCon(suscripcion("A", 300000, 100000)),
      1,
      50000
    );
    assert.equal(parcial.ok, true);
  });

  test("rechaza el pago que deja saldo a favor y dice cuánto falta", async () => {
    // El número del mensaje es lo que el cajero va a tipear, así que tiene que
    // ser el restante real, no el precio del plan.
    const r = await validarCobroSuscripcion(
      conexionCon(suscripcion("A", 300000, 250000)),
      1,
      100000
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.message, /50000/);
  });

  test("un plan sin costo no tiene tope", async () => {
    // PlanPrecio 0 = plan de cortesía: no se topa el monto.
    const r = await validarCobroSuscripcion(
      conexionCon(suscripcion("A", 0, 0)),
      1,
      999999
    );
    assert.equal(r.ok, true);
  });
});
