// Aritmética del tablero mensual. Son los porcentajes sobre los que la
// administración va a decidir, así que los casos de borde importan más que el
// caso feliz: un mes anterior en cero, una meta sin definir o un resultado
// negativo son justo donde un porcentaje mal calculado engaña.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  variacionPct,
  cumplimientoPct,
  margenPct,
  armarTablero,
  mesAnterior,
} = require("../utils/tablero");

describe("variacionPct", () => {
  test("crecimiento y caída", () => {
    assert.equal(variacionPct(150, 100), 50);
    assert.equal(variacionPct(80, 100), -20);
  });

  test("sin cambios da 0", () => {
    assert.equal(variacionPct(100, 100), 0);
  });

  test("mes anterior en cero devuelve null, no Infinity ni 100", () => {
    // No existe "creció un X%" desde cero. Devolver 100 o Infinity sería
    // inventar una cifra; el frontend muestra "—".
    assert.equal(variacionPct(100, 0), null);
    assert.equal(variacionPct(0, 0), null);
  });

  test("caer a cero desde un valor positivo es -100%", () => {
    assert.equal(variacionPct(0, 100), -100);
  });

  test("base negativa usa el valor absoluto", () => {
    // Pasa con el resultado: de -100 a 50 es una mejora, y el signo del
    // denominador no debe invertir la lectura.
    assert.equal(variacionPct(50, -100), 150);
    assert.equal(variacionPct(-50, -100), 50);
  });

  test("redondea a un decimal", () => {
    assert.equal(variacionPct(1000, 333), 200.3);
  });

  test("null y undefined cuentan como 0", () => {
    assert.equal(variacionPct(null, 100), -100);
    assert.equal(variacionPct(100, undefined), null);
  });
});

describe("cumplimientoPct", () => {
  test("porcentaje sobre la meta", () => {
    assert.equal(cumplimientoPct(80, 100), 80);
    assert.equal(cumplimientoPct(120, 100), 120);
  });

  test("meta en cero significa 'sin meta', no meta imposible", () => {
    // Una meta en 0 es el default de la migración 018: todavía no se cargó.
    // Devolver 0% de cumplimiento leería como fracaso.
    assert.equal(cumplimientoPct(500000, 0), null);
    assert.equal(cumplimientoPct(0, 0), null);
  });

  test("meta negativa también se trata como sin meta", () => {
    assert.equal(cumplimientoPct(100, -50), null);
  });
});

describe("margenPct", () => {
  test("resultado sobre ingresos", () => {
    assert.equal(margenPct(200, 1000), 20);
  });

  test("resultado negativo da margen negativo", () => {
    assert.equal(margenPct(-300, 1000), -30);
  });

  test("sin ingresos devuelve null", () => {
    assert.equal(margenPct(-500, 0), null);
  });
});

describe("mesAnterior", () => {
  test("dentro del mismo año", () => {
    assert.deepEqual(mesAnterior(2026, 9), { anio: 2026, mes: 8 });
  });

  test("enero salta al diciembre anterior", () => {
    assert.deepEqual(mesAnterior(2026, 1), { anio: 2025, mes: 12 });
  });
});

describe("armarTablero", () => {
  // Escenario base: un mes con las tres líneas facturando y dos gastos.
  const actual = {
    gimnasio: 6000000,
    cancha: 4000000,
    cantina: 2000000,
    egresosPorCategoria: [
      { categoria: "COMPRA", monto: 3000000 },
      { categoria: "COMBUSTIBLE", monto: 500000 },
    ],
  };
  const anterior = {
    gimnasio: 5000000,
    cancha: 5000000,
    cantina: 1000000,
    egresosPorCategoria: [{ categoria: "COMPRA", monto: 2000000 }],
  };
  const metas = { gimnasio: 6000000, cancha: 5000000, cantina: 3000000 };
  const porCobrar = { gimnasio: 800000, cantina: 200000, cancha: 100000 };

  const t = armarTablero({ actual, anterior, metas, porCobrar });

  test("declara la base de medición", () => {
    // Que el consumidor no tenga que adivinar si es cobrado o facturado.
    assert.equal(t.base, "caja");
  });

  test("una línea por negocio, en orden fijo", () => {
    assert.deepEqual(
      t.lineas.map((l) => l.clave),
      ["GIMNASIO", "CANCHA", "CANTINA"]
    );
  });

  test("cada línea trae monto, meta, cumplimiento y variación", () => {
    const gym = t.lineas.find((l) => l.clave === "GIMNASIO");
    assert.equal(gym.monto, 6000000);
    assert.equal(gym.meta, 6000000);
    assert.equal(gym.cumplimientoPct, 100);
    assert.equal(gym.mesAnterior, 5000000);
    assert.equal(gym.variacionPct, 20);
    assert.equal(gym.porCobrar, 800000);
  });

  test("una línea que cayó respecto al mes anterior lo muestra", () => {
    const cancha = t.lineas.find((l) => l.clave === "CANCHA");
    assert.equal(cancha.variacionPct, -20);
    assert.equal(cancha.cumplimientoPct, 80);
  });

  test("los ingresos totales son la suma de las líneas", () => {
    assert.equal(t.ingresos.monto, 12000000);
    assert.equal(t.ingresos.mesAnterior, 11000000);
  });

  test("la meta total se deriva de las líneas, no se define aparte", () => {
    // Así no puede contradecir la suma de las metas por línea.
    assert.equal(t.ingresos.meta, 14000000);
    assert.equal(t.ingresos.cumplimientoPct, 85.7);
  });

  test("los egresos se agregan y se ordenan de mayor a menor", () => {
    assert.equal(t.egresos.monto, 3500000);
    assert.deepEqual(
      t.egresos.porCategoria.map((c) => c.categoria),
      ["COMPRA", "COMBUSTIBLE"]
    );
  });

  test("una categoría nueva este mes aparece con variación null", () => {
    // COMBUSTIBLE no existía el mes anterior.
    const comb = t.egresos.porCategoria.find((c) => c.categoria === "COMBUSTIBLE");
    assert.equal(comb.mesAnterior, 0);
    assert.equal(comb.variacionPct, null);
  });

  test("una categoría del mes anterior que ya no existe se sigue mostrando", () => {
    // Si desaparece de la lista, un gasto que se dejó de tener queda
    // invisible y la comparación miente.
    const conFaltante = armarTablero({
      actual: { ...actual, egresosPorCategoria: [{ categoria: "COMPRA", monto: 1000 }] },
      anterior: {
        ...anterior,
        egresosPorCategoria: [
          { categoria: "COMPRA", monto: 1000 },
          { categoria: "TALLER", monto: 900000 },
        ],
      },
    });
    const taller = conFaltante.egresos.porCategoria.find(
      (c) => c.categoria === "TALLER"
    );
    assert.ok(taller, "la categoría del mes anterior debe seguir listada");
    assert.equal(taller.monto, 0);
    assert.equal(taller.mesAnterior, 900000);
    assert.equal(taller.variacionPct, -100);
  });

  test("los egresos no llevan meta", () => {
    assert.equal(t.egresos.meta, null);
    assert.equal(t.egresos.cumplimientoPct, null);
  });

  test("el resultado es ingresos menos egresos, con su margen", () => {
    assert.equal(t.resultado.monto, 8500000);
    assert.equal(t.resultado.mesAnterior, 9000000);
    assert.equal(t.resultado.variacionPct, -5.6);
    assert.equal(t.resultado.margenPct, 70.8);
  });

  test("un mes en pérdida se reporta como negativo, no en cero", () => {
    const enPerdida = armarTablero({
      actual: {
        gimnasio: 1000000,
        cancha: 0,
        cantina: 0,
        egresosPorCategoria: [{ categoria: "COMPRA", monto: 4000000 }],
      },
      anterior: { gimnasio: 0, cancha: 0, cantina: 0, egresosPorCategoria: [] },
    });
    assert.equal(enPerdida.resultado.monto, -3000000);
    assert.equal(enPerdida.resultado.margenPct, -300);
  });

  test("por cobrar suma las tres líneas", () => {
    assert.equal(t.porCobrar.total, 1100000);
    assert.equal(t.porCobrar.gimnasio, 800000);
  });

  test("un mes sin actividad no revienta y no inventa porcentajes", () => {
    const vacio = armarTablero({
      actual: { gimnasio: 0, cancha: 0, cantina: 0, egresosPorCategoria: [] },
      anterior: { gimnasio: 0, cancha: 0, cantina: 0, egresosPorCategoria: [] },
    });
    assert.equal(vacio.ingresos.monto, 0);
    assert.equal(vacio.egresos.monto, 0);
    assert.equal(vacio.resultado.monto, 0);
    assert.equal(vacio.resultado.margenPct, null);
    assert.equal(vacio.ingresos.variacionPct, null);
    assert.deepEqual(vacio.egresos.porCategoria, []);
  });

  test("sin metas cargadas, el cumplimiento es null en todo el tablero", () => {
    // Es el estado en que queda el sistema tras la migración 018 hasta que la
    // administración cargue sus metas.
    const sinMetas = armarTablero({ actual, anterior, metas: {} });
    assert.equal(sinMetas.ingresos.cumplimientoPct, null);
    for (const l of sinMetas.lineas) {
      assert.equal(l.cumplimientoPct, null, `${l.clave} no debería tener cumplimiento`);
    }
  });

  test("faltar datos de una línea la deja en cero, no en undefined", () => {
    const parcial = armarTablero({
      actual: { gimnasio: 500 },
      anterior: {},
    });
    assert.equal(parcial.ingresos.monto, 500);
    for (const l of parcial.lineas) {
      assert.equal(typeof l.monto, "number");
      assert.equal(typeof l.mesAnterior, "number");
    }
  });
});
