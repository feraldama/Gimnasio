// Validación del rango de fechas de los reportes por período.
//
// Es el borde por donde entra texto del usuario, y el modo de fallar es
// traicionero: un regex `\d{4}-\d{2}-\d{2}` acepta '2026-02-31' y
// '2026-13-01', el constructor de Date NO falla con esos (los desborda en
// silencio al 3 de marzo y al 1 de enero de 2027) y el string original llega
// intacto a Postgres, que recién ahí lo rechaza. Resultado: el usuario que se
// equivocó tipeando una fecha recibía un 500 "Error interno" y el log del
// servidor un stack trace, en vez de saber qué corregir.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// `reportes.controller` arrastra `config/db`, que al cargarse abre el pool de
// Postgres y deja el proceso vivo 60 s (idleTimeoutMillis). Acá sólo se prueba
// la validación, que es pura, así que inyectamos un doble del módulo.
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

const { parseRangoFechas, pasoParaRango } = require("../controllers/reportes.controller");

const parse = (fechaDesde, fechaHasta) =>
  parseRangoFechas({ query: { fechaDesde, fechaHasta } });

describe("parseRangoFechas", () => {
  test("acepta un rango válido y cuenta los días de punta a punta", () => {
    const r = parse("2026-06-01", "2026-06-30");
    assert.equal(r.error, undefined);
    assert.equal(r.desde, "2026-06-01");
    assert.equal(r.hasta, "2026-06-30");
    // Inclusivo en los dos extremos: junio tiene 30 días, no 29.
    assert.equal(r.dias, 30);
  });

  test("un solo día es un rango de un día", () => {
    assert.equal(parse("2026-06-15", "2026-06-15").dias, 1);
  });

  test("rechaza fechas faltantes o con otro formato", () => {
    assert.ok(parse(undefined, "2026-06-30").error);
    assert.ok(parse("2026-06-01", "").error);
    assert.ok(parse("01/06/2026", "30/06/2026").error);
    assert.ok(parse("2026-6-1", "2026-06-30").error);
  });

  test("rechaza el rango invertido", () => {
    const r = parse("2026-06-30", "2026-06-01");
    assert.match(r.error, /posterior/);
  });

  test("rechaza fechas que no existen en el calendario", () => {
    // El caso que llegaba a Postgres y volvía como 500.
    assert.ok(parse("2026-02-31", "2026-03-05").error);
    assert.ok(parse("2026-13-01", "2026-13-05").error);
    assert.ok(parse("2026-00-10", "2026-01-20").error);
    assert.ok(parse("2026-06-01", "2026-06-31").error);
  });

  test("29 de febrero: lo rechaza en año común y lo acepta en bisiesto", () => {
    // El chequeo tiene que ser el calendario real, no "día <= 31".
    assert.ok(parse("2026-02-29", "2026-03-05").error, "2026 no es bisiesto");
    assert.equal(parse("2024-02-29", "2024-03-05").error, undefined);
  });

  test("rechaza rangos absurdamente largos con el número pedido", () => {
    const r = parse("1900-01-01", "2026-01-01");
    assert.match(r.error, /no puede superar/);
  });
});

describe("pasoParaRango", () => {
  // El grano baja al crecer el rango para que el gráfico no pase de ~100
  // puntos ni la consulta escanee la tabla una vez por día.
  test("hasta un trimestre va día por día", () => {
    assert.equal(pasoParaRango(1), "dia");
    assert.equal(pasoParaRango(92), "dia");
  });

  test("de un trimestre a un año, por semana", () => {
    assert.equal(pasoParaRango(93), "semana");
    assert.equal(pasoParaRango(400), "semana");
  });

  test("más de un año, por mes", () => {
    assert.equal(pasoParaRango(401), "mes");
    assert.equal(pasoParaRango(3660), "mes");
  });
});
