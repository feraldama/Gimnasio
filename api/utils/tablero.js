// Cálculos del tablero mensual de administración.
//
// Toda la aritmética de comparación vive acá, separada de las consultas, para
// poder probarla: los porcentajes son lo que la administración va a mirar para
// decidir, y los casos de borde (mes anterior en cero, meta sin definir,
// resultado negativo) son justo donde un porcentaje mal calculado engaña.
//
// ------------------------------------------------------------------
// BASE DE MEDICIÓN: CAJA (lo cobrado), no lo facturado.
// ------------------------------------------------------------------
// Es una decisión, no un detalle. Se eligió base caja porque:
//   - Los egresos SÓLO existen en base caja: `registrodiariocaja` registra la
//     plata que salió, no obligaciones devengadas. Restar egresos de caja a
//     ingresos devengados daría un "resultado" que no significa nada.
//   - Es lo que la administración puede reconciliar contra el cajón físico.
//
// De dónde sale cada ingreso cobrado (ver el análisis en tableroMensual):
//   Gimnasio → SUM(pago.PagoMonto)                    por PagoFecha
//   Cantina  → SUM(venta.VentaEntrega)                por VentaFecha
//              + SUM(ventacreditopago.…Monto)         por fecha del cobro
//   Cancha   → SUM(reservas pagadas) - crédito otorgado
//              + SUM(cancha_credito_pago.…Monto)      por fecha del cobro
//
// OJO con `cancha_reserva`: cobrar una reserva la marca 'P' con el TOTAL,
// incluida la parte que quedó a crédito. Por eso hay que descontar el crédito
// otorgado o se cuenta como cobrado algo que todavía no entró. El reporte
// `canchaDiario` que ya existe no hace ese descuento: informa facturado
// aunque lo compare contra una meta de ingreso.

/**
 * Variación porcentual entre dos períodos.
 *
 * Devuelve null cuando la base es 0: no existe "creció un X%" desde cero, y
 * mostrar 100% o Infinity sería inventar una cifra. El frontend muestra "—".
 */
function variacionPct(actual, anterior) {
  const a = Number(actual) || 0;
  const b = Number(anterior) || 0;
  if (b === 0) return null;
  return Number((((a - b) / Math.abs(b)) * 100).toFixed(1));
}

/**
 * Cumplimiento de meta en porcentaje. null si no hay meta definida (una meta
 * en 0 significa "sin meta", no "meta imposible de cumplir").
 */
function cumplimientoPct(valor, meta) {
  const m = Number(meta) || 0;
  if (m <= 0) return null;
  return Number(((Number(valor) || 0) / m * 100).toFixed(1));
}

/**
 * Margen sobre ingresos, en porcentaje. null si no hubo ingresos.
 */
function margenPct(resultado, ingresos) {
  const i = Number(ingresos) || 0;
  if (i === 0) return null;
  return Number(((Number(resultado) || 0) / i * 100).toFixed(1));
}

/**
 * Arma el bloque comparativo de una cifra: valor del mes, mes anterior, meta.
 */
function bloque(valor, anterior, meta) {
  const v = Number(valor) || 0;
  return {
    monto: v,
    mesAnterior: Number(anterior) || 0,
    variacionPct: variacionPct(v, anterior),
    meta: meta === undefined || meta === null ? null : Number(meta) || 0,
    cumplimientoPct: meta === undefined ? null : cumplimientoPct(v, meta),
  };
}

/**
 * Ensambla el tablero completo a partir de los totales ya consultados.
 *
 * @param {object} p
 * @param {object} p.actual    { gimnasio, cantina, cancha, egresosPorCategoria }
 * @param {object} p.anterior  misma forma, del mes anterior
 * @param {object} p.metas     { gimnasio, cantina, cancha }
 * @param {object} p.porCobrar { gimnasio, cantina, cancha }
 */
function armarTablero({ actual, anterior, metas = {}, porCobrar = {} }) {
  const LINEAS = [
    { clave: "GIMNASIO", nombre: "Gimnasio" },
    { clave: "CANCHA", nombre: "Cancha" },
    { clave: "CANTINA", nombre: "Cantina" },
  ];

  const lineas = LINEAS.map((l) => {
    const k = l.clave.toLowerCase();
    return {
      ...l,
      ...bloque(actual[k], anterior[k], metas[k] ?? 0),
      porCobrar: Number(porCobrar[k]) || 0,
    };
  });

  const totalIngresos = lineas.reduce((s, l) => s + l.monto, 0);
  const totalIngresosAnterior = lineas.reduce((s, l) => s + l.mesAnterior, 0);
  const totalMeta = lineas.reduce((s, l) => s + (l.meta || 0), 0);

  // Egresos: se agrupan por categoría y se ordenan de mayor a menor, que es
  // como se lee un gasto (primero lo que más pesa).
  const catsActual = new Map(
    (actual.egresosPorCategoria || []).map((c) => [c.categoria, Number(c.monto) || 0])
  );
  const catsAnterior = new Map(
    (anterior.egresosPorCategoria || []).map((c) => [c.categoria, Number(c.monto) || 0])
  );
  const todasLasCategorias = [
    ...new Set([...catsActual.keys(), ...catsAnterior.keys()]),
  ];
  const egresosPorCategoria = todasLasCategorias
    .map((categoria) => {
      const monto = catsActual.get(categoria) || 0;
      const mesAnterior = catsAnterior.get(categoria) || 0;
      return {
        categoria,
        monto,
        mesAnterior,
        variacionPct: variacionPct(monto, mesAnterior),
      };
    })
    .sort((a, b) => b.monto - a.monto);

  const totalEgresos = egresosPorCategoria.reduce((s, c) => s + c.monto, 0);
  const totalEgresosAnterior = egresosPorCategoria.reduce(
    (s, c) => s + c.mesAnterior,
    0
  );

  const resultado = totalIngresos - totalEgresos;
  const resultadoAnterior = totalIngresosAnterior - totalEgresosAnterior;

  return {
    base: "caja",
    lineas,
    ingresos: bloque(totalIngresos, totalIngresosAnterior, totalMeta),
    egresos: {
      ...bloque(totalEgresos, totalEgresosAnterior, null),
      porCategoria: egresosPorCategoria,
    },
    resultado: {
      ...bloque(resultado, resultadoAnterior, null),
      margenPct: margenPct(resultado, totalIngresos),
    },
    porCobrar: {
      gimnasio: Number(porCobrar.gimnasio) || 0,
      cantina: Number(porCobrar.cantina) || 0,
      cancha: Number(porCobrar.cancha) || 0,
      total:
        (Number(porCobrar.gimnasio) || 0) +
        (Number(porCobrar.cantina) || 0) +
        (Number(porCobrar.cancha) || 0),
    },
  };
}

/** Mes anterior a (anio, mes), con el salto de año. */
function mesAnterior(anio, mes) {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

module.exports = {
  variacionPct,
  cumplimientoPct,
  margenPct,
  bloque,
  armarTablero,
  mesAnterior,
};
