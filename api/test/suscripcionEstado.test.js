// Reglas de vigencia de una suscripción. Es la regla más consultada del
// sistema: la usan el listado de suscripciones, los KPIs del dashboard, el
// control de acceso del kiosko y el reporte de cobranza. Si se rompe, el
// gimnasio deja entrar a socios vencidos o rechaza a socios al día.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  ESTADOS,
  calcularEstadoPorFechas,
} = require("../utils/suscripcionEstado");
const { todayLocalISO, addDaysLocal } = require("../utils/dateUtils");

const HOY = todayLocalISO();

describe("calcularEstadoPorFechas", () => {
  test("hoy dentro del rango -> Activa", () => {
    assert.equal(
      calcularEstadoPorFechas(addDaysLocal(HOY, -10), addDaysLocal(HOY, 10)),
      ESTADOS.ACTIVA
    );
  });

  test("el primer día de vigencia ya cuenta como Activa", () => {
    assert.equal(
      calcularEstadoPorFechas(HOY, addDaysLocal(HOY, 30)),
      ESTADOS.ACTIVA
    );
  });

  test("el último día de vigencia todavía es Activa (rango inclusivo)", () => {
    // Importante para el mostrador: el socio cuyo plan vence HOY tiene que
    // poder entrar hoy. Si esto se volviera exclusivo, perdería un día pagado.
    assert.equal(
      calcularEstadoPorFechas(addDaysLocal(HOY, -30), HOY),
      ESTADOS.ACTIVA
    );
  });

  test("vencida ayer -> Vencida", () => {
    assert.equal(
      calcularEstadoPorFechas(addDaysLocal(HOY, -30), addDaysLocal(HOY, -1)),
      ESTADOS.VENCIDA
    );
  });

  test("empieza mañana -> Futura", () => {
    assert.equal(
      calcularEstadoPorFechas(addDaysLocal(HOY, 1), addDaysLocal(HOY, 30)),
      ESTADOS.FUTURA
    );
  });

  test("una suscripción de un solo día, hoy -> Activa", () => {
    assert.equal(calcularEstadoPorFechas(HOY, HOY), ESTADOS.ACTIVA);
  });

  test("acepta timestamps completos y usa sólo la parte de fecha", () => {
    // Postgres puede devolver DATE como 'YYYY-MM-DD' pero un TIMESTAMP viene
    // con la T; la función tiene que cortar en la T y no comparar strings
    // enteros (una comparación cruda daría Vencida para el último día).
    assert.equal(
      calcularEstadoPorFechas(`${HOY}T00:00:00.000Z`, `${HOY}T23:59:59.000Z`),
      ESTADOS.ACTIVA
    );
  });

  test("sin fechas -> Cancelada (no revienta ni asume vigencia)", () => {
    assert.equal(calcularEstadoPorFechas(null, null), ESTADOS.CANCELADA);
    assert.equal(calcularEstadoPorFechas(undefined, HOY), ESTADOS.CANCELADA);
    assert.equal(calcularEstadoPorFechas(HOY, ""), ESTADOS.CANCELADA);
  });

  test("nunca devuelve Cancelada ni Suspendida por fechas", () => {
    // C y S son decisiones manuales. El modelo las preserva y NO las
    // recalcula (ver conEstadoVigente en suscripcion.model.js); esta función
    // sólo debe emitir A/V/F cuando hay fechas válidas.
    const casos = [
      [addDaysLocal(HOY, -5), addDaysLocal(HOY, 5)],
      [addDaysLocal(HOY, -50), addDaysLocal(HOY, -40)],
      [addDaysLocal(HOY, 40), addDaysLocal(HOY, 50)],
    ];
    for (const [ini, fin] of casos) {
      const estado = calcularEstadoPorFechas(ini, fin);
      assert.ok(
        [ESTADOS.ACTIVA, ESTADOS.VENCIDA, ESTADOS.FUTURA].includes(estado),
        `esperaba A/V/F para ${ini}..${fin}, obtuve ${estado}`
      );
    }
  });

  test("fecha fin anterior a la de inicio: no habilita el acceso", () => {
    // Dato mal cargado. La función evalúa el inicio primero, así que devuelve
    // Futura; lo que importa es que NO devuelva Activa, que es lo único que
    // abre la puerta en el kiosko.
    const estado = calcularEstadoPorFechas(
      addDaysLocal(HOY, 5),
      addDaysLocal(HOY, -5)
    );
    assert.notEqual(estado, ESTADOS.ACTIVA);
    assert.equal(estado, ESTADOS.FUTURA);
  });
});
