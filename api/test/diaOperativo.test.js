const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizarHoraCorte,
  sqlDiaOperativo,
  HORA_CORTE_DEFAULT,
} = require("../utils/diaOperativo");

test("normalizarHoraCorte acepta enteros 0..12", () => {
  assert.equal(normalizarHoraCorte(0), 0);
  assert.equal(normalizarHoraCorte(5), 5);
  assert.equal(normalizarHoraCorte("6"), 6);
  assert.equal(normalizarHoraCorte(12), 12);
});

test("normalizarHoraCorte vuelve al default con valores inválidos", () => {
  for (const v of [-1, 13, 2.5, "abc", null, undefined, "", "  ", "5; DROP TABLE x"]) {
    assert.equal(normalizarHoraCorte(v), HORA_CORTE_DEFAULT, String(v));
  }
});

test("sqlDiaOperativo con corte 0 es el día calendario", () => {
  assert.equal(sqlDiaOperativo("v.VentaFecha", 0), "DATE(v.VentaFecha)");
});

test("sqlDiaOperativo resta la hora de corte", () => {
  assert.match(
    sqlDiaOperativo("v.VentaFecha", 5),
    /ELSE DATE\(v\.VentaFecha - INTERVAL '5 hours'\)/
  );
});

test("sqlDiaOperativo deja en su fecha los movimientos sin hora (00:00:00)", () => {
  assert.match(
    sqlDiaOperativo("v.VentaFecha", 5),
    /WHEN v\.VentaFecha::time = '00:00:00'\s+THEN DATE\(v\.VentaFecha\)/
  );
});

test("sqlDiaOperativo nunca interpola un valor no numérico", () => {
  assert.equal(
    sqlDiaOperativo("v.VentaFecha", "1 hours'); DROP TABLE venta; --"),
    sqlDiaOperativo("v.VentaFecha", HORA_CORTE_DEFAULT)
  );
});

const {
  sqlDiaOperativoPago,
  validarHoraCorte,
} = require("../utils/diaOperativo");

test("sqlDiaOperativoPago con corte 0 es PagoFecha", () => {
  assert.equal(sqlDiaOperativoPago("p", 0), "p.PagoFecha");
});

test("sqlDiaOperativoPago toma la hora del movimiento de caja del cobro", () => {
  const sql = sqlDiaOperativoPago("p", 5);
  assert.match(sql, /rdp\.PagoId = p\.PagoId/);
  assert.match(sql, /INTERVAL '5 hours'/);
  // Sin movimiento de caja queda la fecha del pago.
  assert.match(sql, /, p\.PagoFecha\)$/);
});

test("validarHoraCorte acepta 0..12", () => {
  for (const v of ["0", "5", "12", 7, " 6 "]) {
    assert.equal(validarHoraCorte(v), null, String(v));
  }
});

test("validarHoraCorte rechaza lo que no es un entero 0..12", () => {
  for (const v of ["13", "-1", "2.5", "abc", "", null, undefined, "5h"]) {
    assert.match(validarHoraCorte(v), /entre 0 y 12/, String(v));
  }
});
