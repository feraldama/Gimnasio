// Alcance de "Ventas y cobros del día": un cajero sólo ve hoy y su local,
// aunque mande otra fecha u otro local en la URL.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { resolverAlcance } = require("../utils/movimientosDia");

const HOY = "2026-11-18";

describe("resolverAlcance", () => {
  test("cajero: siempre hoy y su local, ignora fecha y localId", () => {
    const r = resolverAlcance(
      { isAdmin: "N", LocalId: 2 },
      { fecha: "2026-01-01", localId: "1" },
      HOY
    );
    assert.deepEqual(r, { fecha: HOY, localId: 2, puedeElegirFecha: false });
  });

  test("usuario con LocalId 0: todos los locales, o el que elija, pero sólo hoy", () => {
    assert.deepEqual(resolverAlcance({ isAdmin: "N", LocalId: 0 }, {}, HOY), {
      fecha: HOY,
      localId: null,
      puedeElegirFecha: false,
    });
    const r = resolverAlcance(
      { isAdmin: "N", LocalId: 0 },
      { fecha: "2026-01-01", localId: "3" },
      HOY
    );
    assert.equal(r.fecha, HOY);
    assert.equal(r.localId, 3);
  });

  test("admin: puede elegir fecha y local", () => {
    const r = resolverAlcance(
      { isAdmin: "S", LocalId: 1 },
      { fecha: "2026-11-10", localId: "2" },
      HOY
    );
    assert.deepEqual(r, {
      fecha: "2026-11-10",
      localId: 2,
      puedeElegirFecha: true,
    });
  });

  test("admin: fecha mal formada da error", () => {
    const r = resolverAlcance({ isAdmin: "S" }, { fecha: "18/11/2026" }, HOY);
    assert.ok(r.error);
  });

  test("localId inválido = todos los locales", () => {
    const r = resolverAlcance({ isAdmin: "S", LocalId: 0 }, { localId: "x" }, HOY);
    assert.equal(r.localId, null);
  });
});
