// Cálculos de crecimiento de socios: altas, renovaciones y bajas.
//
// Es la métrica que `gimnasioOcupacion` no puede dar. Ese reporte cuenta
// suscripciones cuya `SuscripcionFechaInicio` cae en el mes y las divide por
// una "capacidad", así que un mes de 200 renovaciones se ve idéntico a un mes
// de 200 socios nuevos. Para una administración con metas de crecimiento esa
// distinción es lo único que importa.
//
// ------------------------------------------------------------------
// DEFINICIONES
// ------------------------------------------------------------------
// ALTA          PERSONA cuya primera cobertura arranca en el mes. Se cuenta
//               por cliente y no por suscripción: un socio nuevo que compra
//               dos planes el mismo día es UN socio nuevo.
//
// BAJA          PERSONA cuya última cobertura termina en el mes. También por
//               cliente, y tomando el MAX de la fecha de fin — así un socio
//               con planes solapados no figura como baja mientras siga
//               teniendo cobertura vigente.
//
// RENOVACIÓN    SUSCRIPCIÓN que arranca en el mes y no es la primera de ese
//               cliente. Cuenta eventos de renovación, no personas.
//
// VENCIDA       Suscripción cuya `SuscripcionFechaFin` cae en el mes. Es el
//               universo sobre el que se mide la retención.
//
// RETENIDA      Vencida cuyo cliente tomó otra suscripción que arranca dentro
//               de la ventana de gracia posterior al vencimiento.
//
// CRECIMIENTO   Variación de socios ACTIVOS entre el cierre de este mes y el
//               del anterior. No es altas − bajas: esas son conteos de
//               eventos que no cierran contra el stock (ver
//               `variacionActivos`). Es la cifra que responde "¿el gimnasio
//               crece o se vacía?".
//
// CANCELADA     SUSCRIPCIÓN en estado 'C' cuya fecha de fin cae en el mes y
//               que arrancó ANTES del mes. Es informativa y NO entra en las
//               bajas: el estado 'C' no distingue "el socio se fue" de "el
//               alta se cargó mal y se anuló", y sumarlo al neto inventaría
//               rotación que no existió.
//
// ------------------------------------------------------------------
// POR QUÉ HACE FALTA UNA VENTANA DE GRACIA
// ------------------------------------------------------------------
// Sin ventana, un socio cuyo plan vence el 30 de septiembre y renueva el 3 de
// octubre figuraría como baja de septiembre. La gracia (configurable con
// `RETENCION_DIAS_GRACIA`) absorbe el desfase normal entre vencimiento y
// pago, que en un gimnasio es de días.
//
// CONSECUENCIA: el mes en curso y el anterior son PROVISORIOS. Un socio que
// todavía está dentro de su ventana de gracia no es ni retenido ni baja
// definitiva; el reporte lo cuenta como baja hasta que renueve. Por eso la
// respuesta marca `provisorio` cuando la ventana del mes todavía no cerró.

const GRACIA_POR_DEFECTO = 15;

/**
 * Porcentaje de retención: de las que vencieron, cuántas se renovaron.
 * null si no venció ninguna — no existe "retuvimos el 0%" sin universo.
 */
function tasaRetencionPct(retenidas, vencidas) {
  const v = Number(vencidas) || 0;
  if (v === 0) return null;
  const r = Number(retenidas) || 0;
  return Number(((r / v) * 100).toFixed(1));
}

/**
 * Variación de socios activos entre dos cierres de mes.
 *
 * ES LA CIFRA DE CRECIMIENTO, y a propósito NO es altas menos bajas.
 *
 * Altas y bajas son conteos de EVENTOS y no cierran contra el stock de
 * socios: un socio que se va en marzo y vuelve en junio no figura como baja
 * de marzo (su última cobertura termina en junio) y tampoco como alta de
 * junio (no es su primera). Restar eventos daba números que no reconciliaban
 * con la cantidad real de gente en el gimnasio.
 *
 * La variación de activos sí es incontestable: es la diferencia entre cuántas
 * personas tenían cobertura al cierre de un mes y del anterior.
 */
function variacionActivos(activosFin, activosFinAnterior) {
  return (Number(activosFin) || 0) - (Number(activosFinAnterior) || 0);
}

/**
 * Variación porcentual, con la misma convención que el tablero: null cuando
 * la base es 0, porque no existe un porcentaje de cambio desde cero.
 */
function variacionPct(actual, anterior) {
  const a = Number(actual) || 0;
  const b = Number(anterior) || 0;
  if (b === 0) return null;
  return Number((((a - b) / Math.abs(b)) * 100).toFixed(1));
}

/**
 * Ensambla la respuesta a partir de los conteos ya consultados.
 *
 * @param {object} p
 * @param {object} p.actual    { altas, renovaciones, vencidas, retenidas, canceladas, activosFin }
 * @param {object} p.anterior  misma forma, del mes anterior
 * @param {number} p.diasGracia
 * @param {boolean} p.provisorio  true si la ventana de gracia del mes no cerró
 */
function armarCrecimiento({ actual, anterior, diasGracia, provisorio }) {
  const n = (o, k) => Number(o?.[k]) || 0;

  const altas = n(actual, "altas");
  const bajas = n(actual, "bajas");
  const renovaciones = n(actual, "renovaciones");
  const vencidas = n(actual, "vencidas");
  const retenidas = n(actual, "retenidas");
  const canceladas = n(actual, "canceladas");

  const altasAnt = n(anterior, "altas");
  const bajasAnt = n(anterior, "bajas");

  return {
    diasGracia,
    provisorio: !!provisorio,
    altas: {
      cantidad: altas,
      mesAnterior: altasAnt,
      variacionPct: variacionPct(altas, altasAnt),
    },
    renovaciones: {
      cantidad: renovaciones,
      mesAnterior: n(anterior, "renovaciones"),
      variacionPct: variacionPct(renovaciones, n(anterior, "renovaciones")),
    },
    bajas: {
      cantidad: bajas,
      mesAnterior: bajasAnt,
      variacionPct: variacionPct(bajas, bajasAnt),
    },
    retencion: {
      vencidas,
      retenidas,
      canceladas,
      tasaPct: tasaRetencionPct(retenidas, vencidas),
      tasaPctMesAnterior: tasaRetencionPct(
        n(anterior, "retenidas"),
        n(anterior, "vencidas")
      ),
    },
    // Crecimiento real: cambio en el stock de socios con cobertura.
    variacionActivos: {
      cantidad: variacionActivos(
        n(actual, "activosFin"),
        n(anterior, "activosFin")
      ),
      activosFinDeMes: n(actual, "activosFin"),
      activosFinMesAnterior: n(anterior, "activosFin"),
    },
    activosFinDeMes: n(actual, "activosFin"),
  };
}

module.exports = {
  GRACIA_POR_DEFECTO,
  tasaRetencionPct,
  variacionActivos,
  variacionPct,
  armarCrecimiento,
};
