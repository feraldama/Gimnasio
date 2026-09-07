// Helpers de fecha local. El comentario del módulo dice explícitamente por qué
// existen: `new Date().toISOString()` devuelve UTC y en Paraguay (GMT-3) eso
// adelanta el día entre las 21:00 y las 23:59 locales. O sea que una asistencia
// registrada a las 22:00 quedaría contada al día siguiente, y el cierre de caja
// de la noche caería en la fecha equivocada. Estos tests fijan el reloj en esa
// franja para que la regresión no vuelva.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  todayLocalISO,
  toLocalISODate,
  addDaysLocal,
} = require("../utils/dateUtils");

describe("todayLocalISO", () => {
  test("devuelve el formato YYYY-MM-DD", () => {
    assert.match(todayLocalISO(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test("a las 22:00 locales devuelve HOY, no el día siguiente", (t) => {
    // 22:00 del 15/03 en hora local. En GMT-3 eso es 01:00 UTC del 16/03:
    // toISOString() diría "2026-03-16" y sería un día de más.
    t.mock.timers.enable({
      apis: ["Date"],
      now: new Date(2026, 2, 15, 22, 0, 0),
    });
    assert.equal(todayLocalISO(), "2026-03-15");
  });

  test("a las 00:30 locales devuelve el día que arranca", (t) => {
    t.mock.timers.enable({
      apis: ["Date"],
      now: new Date(2026, 2, 16, 0, 30, 0),
    });
    assert.equal(todayLocalISO(), "2026-03-16");
  });

  test("rellena mes y día con cero a la izquierda", (t) => {
    t.mock.timers.enable({
      apis: ["Date"],
      now: new Date(2026, 0, 5, 12, 0, 0),
    });
    assert.equal(todayLocalISO(), "2026-01-05");
  });
});

describe("toLocalISODate", () => {
  test("formatea un Date con getters locales", () => {
    assert.equal(toLocalISODate(new Date(2026, 8, 7, 23, 59)), "2026-09-07");
  });

  test("no corre el día para un Date de fin de mes por la noche", () => {
    assert.equal(toLocalISODate(new Date(2026, 8, 30, 23, 0)), "2026-09-30");
  });
});

describe("addDaysLocal", () => {
  test("suma días dentro del mismo mes", () => {
    assert.equal(addDaysLocal("2026-03-10", 5), "2026-03-15");
  });

  test("cruza fin de mes", () => {
    assert.equal(addDaysLocal("2026-03-30", 3), "2026-04-02");
  });

  test("cruza fin de año", () => {
    assert.equal(addDaysLocal("2026-12-30", 3), "2027-01-02");
  });

  test("resta con días negativos", () => {
    assert.equal(addDaysLocal("2026-03-02", -3), "2026-02-27");
  });

  test("año bisiesto: 2028 tiene 29 de febrero", () => {
    assert.equal(addDaysLocal("2028-02-28", 1), "2028-02-29");
    assert.equal(addDaysLocal("2028-02-28", 2), "2028-03-01");
  });

  test("año NO bisiesto: 2026 salta del 28/02 al 01/03", () => {
    assert.equal(addDaysLocal("2026-02-28", 1), "2026-03-01");
  });

  test("un plan mensual de 30 días desde fin de mes", () => {
    // Caso real: alta de suscripción el 31/01 con PlanDuracion 30.
    assert.equal(addDaysLocal("2026-01-31", 30), "2026-03-02");
  });

  test("sumar 0 días devuelve la misma fecha", () => {
    assert.equal(addDaysLocal("2026-03-10", 0), "2026-03-10");
  });

  test("acepta timestamp y descarta la hora", () => {
    assert.equal(addDaysLocal("2026-03-10T18:45:00.000Z", 1), "2026-03-11");
  });

  test("entrada vacía o inválida devuelve cadena vacía, no una fecha falsa", () => {
    // Devolver "" permite que el llamador detecte el problema; devolver una
    // fecha inventada (como haría new Date(undefined)) lo escondería.
    assert.equal(addDaysLocal("", 5), "");
    assert.equal(addDaysLocal(null, 5), "");
    assert.equal(addDaysLocal(undefined, 5), "");
    assert.equal(addDaysLocal("no-es-fecha", 5), "");
  });
});
