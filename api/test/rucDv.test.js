// Dígito verificador del RUC (módulo 11 de la SET). Va impreso en la factura
// legal, así que un error acá sale en documentos tributarios.
//
// Los valores esperados NO salen de correr la misma función: se calcularon con
// una implementación independiente escrita desde la especificación (recorrido
// de derecha a izquierda, peso 2..11 cíclico, letras a su código ASCII,
// resto = suma % 11, DV = 11 - resto si resto > 1 y 0 si no). Además el
// algoritmo se cruzó contra los 706 clientes importados del sistema anterior
// que ya traían su DV calculado: coincidieron los 706. Ese cruce vive en
// test/integration/rucDv.datos.test.js, que necesita base.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { calcularDV, formatearRUC } = require("../utils/rucDv");

// [entrada, DV esperado]
const CASOS = [
  ["1", 9],
  ["2", 7],
  ["80", 9],
  ["100", 7],
  ["4321", 4],
  ["1234567", 9],
  ["5000000", 4],
  ["12345678", 9],
  ["80012345", 0],
  ["800123456", 8],
  ["999999999", 9],
  ["1000000000", 0],
];

describe("calcularDV", () => {
  for (const [entrada, esperado] of CASOS) {
    test(`RUC ${entrada} -> DV ${esperado}`, () => {
      assert.equal(calcularDV(entrada), esperado);
    });
  }

  test("acepta número además de string", () => {
    assert.equal(calcularDV(12345678), calcularDV("12345678"));
  });

  test("ignora puntos y guiones del formato de entrada", () => {
    // El operador tipea "1.234.567" o "1234567-9"; el DV es el del número.
    assert.equal(calcularDV("1.234.567"), calcularDV("1234567"));
    assert.equal(calcularDV("1234-567"), calcularDV("1234567"));
  });

  test("expande letras a su código ASCII (RUC de persona jurídica)", () => {
    assert.equal(calcularDV("A1"), 3);
    assert.equal(calcularDV("80ABC123"), 0);
  });

  test("las minúsculas se tratan igual que las mayúsculas", () => {
    assert.equal(calcularDV("80abc123"), calcularDV("80ABC123"));
  });

  test("entrada vacía o nula devuelve 0 y no revienta", () => {
    assert.equal(calcularDV(null), 0);
    assert.equal(calcularDV(undefined), 0);
    assert.equal(calcularDV(""), 0);
    assert.equal(calcularDV("---"), 0);
  });

  test("el DV siempre queda entre 0 y 9", () => {
    // Propiedad del módulo 11 tal como lo aplica la SET: el resto 0 y 1 se
    // mapean a 0, así que nunca sale 10.
    for (let n = 1; n <= 3000; n++) {
      const d = calcularDV(String(n));
      assert.ok(
        Number.isInteger(d) && d >= 0 && d <= 9,
        `DV fuera de rango para ${n}: ${d}`
      );
    }
  });

  test("es determinista", () => {
    assert.equal(calcularDV("80012345"), calcularDV("80012345"));
  });
});

describe("formatearRUC", () => {
  test("arma RUC-DV", () => {
    assert.equal(formatearRUC("80012345", 0), "80012345-0");
    assert.equal(formatearRUC("1234567", 9), "1234567-9");
  });

  test("sin RUC devuelve cadena vacía", () => {
    assert.equal(formatearRUC("", 9), "");
    assert.equal(formatearRUC(null, 9), "");
  });

  test("sin DV devuelve el RUC solo, sin guión colgando", () => {
    assert.equal(formatearRUC("80012345", null), "80012345");
    assert.equal(formatearRUC("80012345", undefined), "80012345");
    assert.equal(formatearRUC("80012345", ""), "80012345");
  });

  test("DV 0 se imprime (no se confunde con ausencia de DV)", () => {
    // Riesgo clásico: 0 es falsy en JS. Un RUC con DV 0 tiene que salir
    // "80012345-0" en la factura, no "80012345".
    assert.equal(formatearRUC("80012345", 0), "80012345-0");
  });
});
