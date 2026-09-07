// Aritmética del reporte de crecimiento de socios. Las definiciones (qué
// cuenta como alta, renovación o baja) se prueban contra la base en
// test/integration/crecimiento.test.js; acá van los cálculos derivados.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  tasaRetencionPct,
  variacionActivos,
  variacionPct,
  armarCrecimiento,
} = require("../utils/crecimiento");

describe("tasaRetencionPct", () => {
  test("porcentaje de las vencidas que volvieron", () => {
    assert.equal(tasaRetencionPct(8, 10), 80);
    assert.equal(tasaRetencionPct(10, 10), 100);
    assert.equal(tasaRetencionPct(0, 10), 0);
  });

  test("sin vencidas devuelve null, no 0", () => {
    // No existe "retuvimos el 0%" cuando no había a quién retener. Un 0%
    // leería como catástrofe en un mes donde simplemente no vencía nadie.
    assert.equal(tasaRetencionPct(0, 0), null);
    assert.equal(tasaRetencionPct(5, 0), null);
  });

  test("redondea a un decimal", () => {
    assert.equal(tasaRetencionPct(2, 3), 66.7);
  });
});

describe("variacionActivos", () => {
  test("diferencia de socios activos entre cierres", () => {
    assert.equal(variacionActivos(180, 170), 10);
  });

  test("perder socios da negativo y no se recorta", () => {
    // Es la cifra que dice si el gimnasio se está vaciando.
    assert.equal(variacionActivos(150, 170), -20);
  });

  test("sin cambios da 0", () => {
    assert.equal(variacionActivos(170, 170), 0);
  });
});

describe("variacionPct", () => {
  test("mismo criterio que el tablero: null desde cero", () => {
    assert.equal(variacionPct(5, 0), null);
    assert.equal(variacionPct(10, 5), 100);
    assert.equal(variacionPct(0, 5), -100);
  });
});

describe("armarCrecimiento", () => {
  // altas y bajas vienen en PERSONAS; renovaciones y retención, en
  // suscripciones. El controlador las consulta por separado.
  const actual = {
    altas: 12,
    bajas: 12,
    renovaciones: 30,
    vencidas: 40,
    retenidas: 30,
    canceladas: 2,
    activosFin: 180,
  };
  const anterior = {
    altas: 8,
    bajas: 6,
    renovaciones: 25,
    vencidas: 30,
    retenidas: 25,
    canceladas: 1,
    activosFin: 170,
  };
  const r = armarCrecimiento({ actual, anterior, diasGracia: 15, provisorio: false });

  test("las bajas vienen dadas, no se derivan de la retención", () => {
    // Antes se calculaban como vencidas − retenidas + canceladas, y eso
    // mezclaba unidades: las vencidas son suscripciones y las bajas, personas.
    // Ahora el controlador las consulta por cliente y acá sólo se transportan.
    assert.equal(r.bajas.cantidad, 12);
  });

  test("las canceladas NO entran en las bajas", () => {
    // 'C' no distingue "se fue" de "el alta se cargó mal": sumarlas
    // inventaría rotación.
    const conCanceladas = armarCrecimiento({
      actual: { altas: 5, bajas: 2, canceladas: 99 },
      anterior: {},
      diasGracia: 15,
      provisorio: false,
    });
    assert.equal(conCanceladas.bajas.cantidad, 2);
    assert.equal(conCanceladas.retencion.canceladas, 99, "pero sí se informan");
  });

  test("el crecimiento sale del stock de activos, no de altas menos bajas", () => {
    // 12 altas y 12 bajas darían 0 por resta de eventos, pero el stock de
    // socios subió de 170 a 180. Los eventos no cierran contra el stock: un
    // socio que se fue en marzo y volvió en junio no es baja de marzo ni alta
    // de junio. La cifra confiable es la diferencia de activos.
    assert.equal(r.variacionActivos.cantidad, 10);
    assert.equal(r.variacionActivos.activosFinDeMes, 180);
    assert.equal(r.variacionActivos.activosFinMesAnterior, 170);
    assert.equal(r.neto, undefined, "el neto por resta de eventos ya no se expone");
  });

  test("la tasa de retención sale de vencidas contra retenidas", () => {
    assert.equal(r.retencion.tasaPct, 75);
    assert.equal(r.retencion.tasaPctMesAnterior, 83.3);
  });

  test("cada cifra trae su comparación con el mes anterior", () => {
    assert.equal(r.altas.mesAnterior, 8);
    assert.equal(r.altas.variacionPct, 50);
    assert.equal(r.bajas.mesAnterior, 6);
    assert.equal(r.bajas.variacionPct, 100);
  });

  test("expone la ventana de gracia y si el mes es provisorio", () => {
    // Sin esos dos datos la cifra de bajas no se puede interpretar.
    assert.equal(r.diasGracia, 15);
    assert.equal(r.provisorio, false);
    const prov = armarCrecimiento({ actual, anterior, diasGracia: 15, provisorio: true });
    assert.equal(prov.provisorio, true);
  });

  test("un mes vacío no inventa porcentajes", () => {
    const vacio = armarCrecimiento({
      actual: {},
      anterior: {},
      diasGracia: 15,
      provisorio: false,
    });
    assert.equal(vacio.altas.cantidad, 0);
    assert.equal(vacio.bajas.cantidad, 0);
    assert.equal(vacio.variacionActivos.cantidad, 0);
    assert.equal(vacio.altas.variacionPct, null);
    assert.equal(vacio.retencion.tasaPct, null);
  });

  test("faltar campos no produce NaN ni undefined", () => {
    const parcial = armarCrecimiento({
      actual: { altas: 3 },
      anterior: undefined,
      diasGracia: 15,
      provisorio: false,
    });
    for (const clave of ["altas", "renovaciones", "bajas"]) {
      assert.equal(
        typeof parcial[clave].cantidad,
        "number",
        `${clave}.cantidad debe ser número`
      );
      assert.ok(!Number.isNaN(parcial[clave].cantidad), `${clave} no debe ser NaN`);
    }
    assert.equal(parcial.altas.cantidad, 3);
  });

  test("un mes con más renovaciones que altas se distingue claramente", () => {
    // Es el punto del reporte: 200 renovaciones y 0 altas nuevas no es lo
    // mismo que 200 socios nuevos, y `gimnasioOcupacion` los ve igual.
    const soloRenueva = armarCrecimiento({
      actual: {
        altas: 0,
        bajas: 0,
        renovaciones: 200,
        vencidas: 200,
        retenidas: 200,
      },
      anterior: {},
      diasGracia: 15,
      provisorio: false,
    });
    assert.equal(soloRenueva.altas.cantidad, 0);
    assert.equal(soloRenueva.renovaciones.cantidad, 200);
    assert.equal(soloRenueva.retencion.tasaPct, 100);
    assert.equal(
      soloRenueva.variacionActivos.cantidad,
      0,
      "retención perfecta pero sin crecer"
    );
  });
});
