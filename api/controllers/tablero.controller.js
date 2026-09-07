// Tablero mensual de administración.
//
// Ingresos por línea de negocio + egresos por categoría + resultado, cada
// cifra contra su meta y contra el mes anterior. Vive en su propio
// controlador porque es una vista de gestión, distinta de los reportes
// operativos de `reportes.controller` (heatmap, bandas, rotación).
//
// La aritmética de comparación está en `utils/tablero.js`, donde también se
// documenta por qué la base de medición es CAJA (lo cobrado) y no facturado.
//
// ------------------------------------------------------------------
// DE DÓNDE SALE CADA CIFRA, Y POR QUÉ
// ------------------------------------------------------------------
// `registrodiariocaja` es el libro único donde caen los movimientos de plata
// de las tres líneas, con el signo dado por TipoGastoId (1 = EGRESOS,
// 2 = INGRESOS). Sería el lugar natural para sacar todo, pero las escrituras
// son CONDICIONALES y no de forma uniforme entre flujos:
//
//   pago.controller (gimnasio)     → escribe SÓLO si hay caja abierta; si no,
//                                    el pago queda en `pago` y nunca llega al
//                                    libro. El libro es INCOMPLETO.
//   canchaReserva / canchaCredito  → ABORTAN con 409 SIN_CAJA sin caja
//                                    abierta, así que no existe cobro de
//                                    cancha sin su movimiento. El libro es
//                                    COMPLETO y trae la fecha real del cobro.
//   venta.controller (cantina)     → escribe siempre, con el CajaId del
//                                    request.
//   compra.controller              → escribe siempre.
//
// De ahí la mezcla de fuentes, que es deliberada:
//
//   Gimnasio → tabla `pago` (el libro se saltea cobros con caja cerrada)
//   Cantina  → tablas `venta` + `ventacreditopago`
//   Cancha   → tablas `cancha_reserva` + `cancha_credito(_pago)`. El libro
//              parecía mejor (tiene la fecha real del cobro) pero en los
//              datos del gimnasio hay 257 reservas pagadas y cero movimientos
//              de cancha en el libro. Ver el detalle en el cálculo más abajo.
//   Egresos  → el LIBRO, es la única fuente que existe.
//
// ------------------------------------------------------------------
// EXCLUSIONES OBLIGATORIAS
// ------------------------------------------------------------------
// APERTURA DE CAJA (grupo 2 de INGRESOS) es el fondo con el que arranca el
// turno, no facturación. CIERRE DE CAJA (grupo 2 de EGRESOS) es el barrido
// del cajón, no un gasto. Contar cualquiera de los dos infla el tablero.
//
// ANULACION COBRO CANCHA (grupo 10 de EGRESOS, migración 019) se excluye de
// los egresos y se netea contra el ingreso de cancha: revertir un cobro no es
// un gasto operativo.
const db = require("../config/db");
const Configuracion = require("../models/configuracion.model");
const { sendError } = require("../utils/errors");
const { armarTablero, mesAnterior } = require("../utils/tablero");
const {
  armarCrecimiento,
  GRACIA_POR_DEFECTO,
} = require("../utils/crecimiento");

function parseAnioMes(req) {
  const anio = parseInt(req.query.anio, 10);
  const mes = parseInt(req.query.mes, 10);
  if (!anio || anio < 2000 || anio > 2999) {
    return { error: "Parametro anio invalido" };
  }
  if (!mes || mes < 1 || mes > 12) {
    return { error: "Parametro mes invalido (1-12)" };
  }
  return { anio, mes };
}

exports.tableroMensual = async (req, res) => {
  try {
    const { anio, mes, error } = parseAnioMes(req);
    if (error) return res.status(400).json({ error });

    const queryAsync = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params || [], (err, rows) =>
          err ? reject(err) : resolve(rows)
        );
      });
    const escalar = async (sql, params) => {
      const rows = await queryAsync(sql, params);
      return Number(rows[0]?.total || 0);
    };

    // Ingresos cobrados de un mes por línea, más egresos por categoría.
    async function totalesDeMes(a, m) {
      // Gimnasio: `pago` ya es plata cobrada, no hay nada que descontar.
      const gimnasio = await escalar(
        `SELECT COALESCE(SUM(PagoMonto), 0)::bigint AS total
           FROM pago
          WHERE EXTRACT(YEAR FROM PagoFecha)::int = ?
            AND EXTRACT(MONTH FROM PagoFecha)::int = ?`,
        [a, m]
      );

      // Cantina: cobro inicial de las ventas del mes + cobros de crédito
      // recibidos en el mes.
      //
      // CUIDADO CON `VentaEntrega`: no es "lo cobrado en el acto" sino un
      // ACUMULADO de todo lo cobrado sobre esa venta. Al cobrar una cuota,
      // `ventacreditopago.controller` hace
      // `UPDATE venta SET VentaEntrega = VentaEntrega + monto`.
      //
      // La primera versión sumaba `SUM(VentaEntrega)` del mes MÁS los cobros
      // de crédito del mes, y eso contaba cada cobro de crédito DOS VECES:
      // una dentro del VentaEntrega de la venta original y otra como cobro.
      // Peor todavía, era retroactivo: cobrar hoy una cuenta vieja subía el
      // ingreso del mes en que se hizo la venta.
      //
      // El cobro inicial se reconstruye restando del acumulado los cobros de
      // crédito ya aplicados a esa venta. La cadena es
      // venta → ventacredito → ventacreditopago.
      const cantinaContado = await escalar(
        `SELECT COALESCE(SUM(v.VentaEntrega - COALESCE(cp.cobrado, 0)), 0)::bigint AS total
           FROM venta v
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(vcp.VentaCreditoPagoMonto), 0) AS cobrado
               FROM ventacredito vc
               JOIN ventacreditopago vcp
                    ON vcp.VentaCreditoId = vc.VentaCreditoId
              WHERE vc.VentaId = v.VentaId
           ) cp ON true
          WHERE EXTRACT(YEAR FROM v.VentaFecha)::int = ?
            AND EXTRACT(MONTH FROM v.VentaFecha)::int = ?`,
        [a, m]
      );
      // Cobros de crédito por la fecha en que entró la plata.
      const cantinaCredito = await escalar(
        `SELECT COALESCE(SUM(VentaCreditoPagoMonto), 0)::bigint AS total
           FROM ventacreditopago
          WHERE EXTRACT(YEAR FROM VentaCreditoPagoFecha)::int = ?
            AND EXTRACT(MONTH FROM VentaCreditoPagoFecha)::int = ?`,
        [a, m]
      );

      // Cancha: reservas pagadas del mes, menos el credito que quedo a deber
      // sobre ESAS reservas, mas los cobros de credito recibidos en el mes.
      //
      // HISTORIA DE ESTE CALCULO (dos correcciones):
      //
      // 1) La primera version tenia un bug de atribucion: sumaba las reservas
      //    por `CanchaReservaFecha` pero restaba el credito por
      //    `CanchaCreditoFecha`. Son fechas distintas — el credito se otorga
      //    cuando se cobra, la reserva puede ser de otro dia — asi que una
      //    reserva del 3 de octubre cobrada el 30 de septiembre restaba en
      //    septiembre y sumaba entera en octubre.
      //
      // 2) El segundo intento leyo todo del libro de caja (grupo 7, COBRO
      //    CANCHA), que tiene la fecha real del cobro y que en teoria es
      //    fuente completa porque `cobrar` aborta con 409 SIN_CAJA sin caja
      //    abierta. Pero en los datos reales del gimnasio hay 257 reservas
      //    marcadas como pagadas y CERO movimientos de grupo 7: se cargaron
      //    por fuera del flujo de cobro (ver scripts/import-winners.js y
      //    reconstruir-creditos-cancha.js). Leer del libro reportaba cero
      //    donde habia decenas de millones.
      //
      // Version actual: se lee de `cancha_reserva`, que es la fuente con
      // historia, y el credito se atribuye a la fecha de SU RESERVA mediante
      // el JOIN — asi los dos primeros terminos quedan en la misma base y el
      // bug de atribucion desaparece.
      //
      // Las reservas anuladas quedan en estado 'X', asi que salen solas del
      // filtro `= 'P'` y no hace falta descontar las anulaciones del libro.
      const canchaReservas = await escalar(
        `SELECT COALESCE(SUM(CanchaReservaMonto), 0)::bigint AS total
           FROM cancha_reserva
          WHERE CanchaReservaEstado = 'P'
            AND EXTRACT(YEAR FROM CanchaReservaFecha)::int = ?
            AND EXTRACT(MONTH FROM CanchaReservaFecha)::int = ?`,
        [a, m]
      );
      // Credito otorgado, atribuido al mes de la RESERVA (no al de la fila de
      // credito) para que reste del mismo monto que se sumo arriba.
      const canchaCreditoOtorgado = await escalar(
        `SELECT COALESCE(SUM(cc.CanchaCreditoMonto), 0)::bigint AS total
           FROM cancha_credito cc
           JOIN cancha_reserva cr ON cr.CanchaReservaId = cc.CanchaReservaId
          WHERE cr.CanchaReservaEstado = 'P'
            AND EXTRACT(YEAR FROM cr.CanchaReservaFecha)::int = ?
            AND EXTRACT(MONTH FROM cr.CanchaReservaFecha)::int = ?`,
        [a, m]
      );
      // Cobros de credito: si van por su propia fecha, que es cuando entro la
      // plata. Un cobro de este mes por una reserva vieja suma este mes.
      const canchaCreditoCobrado = await escalar(
        `SELECT COALESCE(SUM(CanchaCreditoPagoMonto), 0)::bigint AS total
           FROM cancha_credito_pago
          WHERE EXTRACT(YEAR FROM CanchaCreditoPagoFecha)::int = ?
            AND EXTRACT(MONTH FROM CanchaCreditoPagoFecha)::int = ?`,
        [a, m]
      );

      const egresosPorCategoria = (
        await queryAsync(
          `SELECT COALESCE(g.TipoGastoGrupoDescripcion, 'SIN CATEGORIA') AS categoria,
                  COALESCE(SUM(r.RegistroDiarioCajaMonto), 0)::bigint AS monto
             FROM registrodiariocaja r
             LEFT JOIN tipogastogrupo g
                    ON g.TipoGastoId = r.TipoGastoId
                   AND g.TipoGastoGrupoId = r.TipoGastoGrupoId
            WHERE r.TipoGastoId = 1
              AND r.TipoGastoGrupoId <> 2
              AND r.TipoGastoGrupoId <> 10
              AND EXTRACT(YEAR FROM r.RegistroDiarioCajaFecha)::int = ?
              AND EXTRACT(MONTH FROM r.RegistroDiarioCajaFecha)::int = ?
            GROUP BY categoria`,
          [a, m]
        )
      ).map((r) => ({ categoria: r.categoria, monto: Number(r.monto) || 0 }));

      return {
        gimnasio,
        cantina: cantinaContado + cantinaCredito,
        // Sin piso en 0: recortarlo esconderia una cifra negativa legitima.
        //
        // LIMITACION conocida — el calculo es RETROACTIVO. Anular una reserva
        // la pasa a 'X' y borra su fila de `cancha_credito`, asi que
        // recalcular un mes ya cerrado puede dar un numero distinto al que se
        // vio antes. Es consecuencia de que el sistema no guarda historia de
        // anulaciones, no del calculo.
        cancha: canchaReservas - canchaCreditoOtorgado + canchaCreditoCobrado,
        egresosPorCategoria,
      };
    }

    // Saldos pendientes de cobro: es una foto de HOY, no del mes. Dan el
    // contexto para leer el resultado — un mes flojo de caja puede ser un mes
    // de mucha venta a crédito, no de poca actividad.
    async function saldosPorCobrar() {
      const gimnasio = await escalar(
        `SELECT COALESCE(SUM(GREATEST(COALESCE(p.PlanPrecio, 0) - COALESCE(pg.totalpagado, 0), 0)), 0)::bigint AS total
           FROM suscripcion s
           LEFT JOIN plan p ON p.PlanId = s.PlanId
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(PagoMonto), 0) AS totalpagado
               FROM pago WHERE SuscripcionId = s.SuscripcionId
           ) pg ON true
          WHERE s.SuscripcionEstado NOT IN ('C')`
      );
      const cantina = await escalar(
        `SELECT COALESCE(SUM(GREATEST(Total - COALESCE(VentaEntrega, 0), 0)), 0)::bigint AS total
           FROM venta`
      );
      const cancha = await escalar(
        `SELECT COALESCE(SUM(CanchaCreditoSaldo), 0)::bigint AS total
           FROM cancha_credito`
      );
      return { gimnasio, cantina, cancha };
    }

    const previo = mesAnterior(anio, mes);
    const [actual, anterior, porCobrar] = await Promise.all([
      totalesDeMes(anio, mes),
      totalesDeMes(previo.anio, previo.mes),
      saldosPorCobrar(),
    ]);

    // En paralelo: eran tres `await` secuenciales, o sea tres viajes a la base
    // en fila para leer tres filas de configuración.
    const [metaGimnasio, metaCancha, metaCantina] = await Promise.all([
      Configuracion.getNumero("META_MENSUAL_GIMNASIO", 0),
      Configuracion.getNumero("META_MENSUAL_CANCHA", 0),
      Configuracion.getNumero("META_MENSUAL_CANTINA", 0),
    ]);
    const metas = {
      gimnasio: metaGimnasio,
      cancha: metaCancha,
      cantina: metaCantina,
    };

    res.json({
      anio,
      mes,
      mesAnteriorRef: previo,
      ...armarTablero({ actual, anterior, metas, porCobrar }),
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};


// ============================================================
// CRECIMIENTO DE SOCIOS
// ============================================================
// Altas (socios nuevos), renovaciones y bajas del mes, mas la tasa de
// retencion. Es la pregunta que `gimnasioOcupacion` no puede responder: ese
// reporte cuenta suscripciones que arrancan en el mes sin distinguir un socio
// nuevo de una renovacion, asi que un mes de 200 renovaciones se ve igual que
// un mes de 200 socios nuevos.
//
// Las definiciones (y por que hay una ventana de gracia) estan en
// utils/crecimiento.js. Resumen de como se traduce cada una a SQL:
//
// CUIDADO CON LAS UNIDADES. No todo se mide en lo mismo, y esta explicito
// en la respuesta:
//
//   ALTA        PERSONAS. Clientes cuya primera cobertura arranca en el mes
//               (MIN de FechaInicio por cliente).
//   BAJA        PERSONAS. Clientes cuya ultima cobertura termina en el mes
//               (MAX de FechaFin por cliente).
//   NETO        PERSONAS. altas - bajas. Es la cifra de "el gimnasio crece o
//               se vacia", y solo tiene sentido con las dos en la misma
//               unidad.
//   RENOVACION  SUSCRIPCIONES. Las que arrancan en el mes y no son la primera
//               de ese cliente. Es un conteo de eventos de renovacion, no de
//               personas: si un socio renueva dos planes son dos renovaciones.
//   RETENCION   SUSCRIPCIONES. De las que vencieron en el mes, cuantas se
//               renovaron dentro de la ventana de gracia.
//   VENCIDA     FechaFin en el mes, sin contar las canceladas.
//   RETENIDA    vencida cuyo cliente tomo otra que arranca entre el dia
//               siguiente al vencimiento y +GRACIA dias.
//   CANCELADA   SUSCRIPCIONES en estado 'C' con FechaFin en el mes que
//               ademas arrancaron antes del mes. Es informativo y NO entra en
//               las bajas: 'C' no distingue "el socio se fue" de "el alta se
//               cargo mal y se anulo", y sumarlo al neto inventaria rotacion.
//
// Los socios activos al cierre se cuentan con DISTINCT ClienteId, que es la
// pregunta "cuanta gente tengo".
exports.crecimientoSocios = async (req, res) => {
  try {
    const { anio, mes, error } = parseAnioMes(req);
    if (error) return res.status(400).json({ error });

    const queryAsync = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params || [], (err, rows) =>
          err ? reject(err) : resolve(rows)
        );
      });
    const escalar = async (sql, params) => {
      const rows = await queryAsync(sql, params);
      return Number(rows[0]?.total || 0);
    };

    const diasGracia = await Configuracion.getNumero(
      "RETENCION_DIAS_GRACIA",
      GRACIA_POR_DEFECTO
    );

    async function contarMes(a, m) {
      // Altas: PERSONAS cuya primera cobertura arranca en el mes.
      //
      // Se cuenta por cliente (MIN de la fecha de inicio) y no por
      // suscripcion. Contando suscripciones, un socio nuevo que compra dos
      // planes el mismo dia figuraba como dos socios nuevos.
      const altas = await escalar(
        `SELECT COUNT(*)::int AS total
           FROM (
             SELECT s.ClienteId, MIN(DATE(s.SuscripcionFechaInicio)) AS primera
               FROM suscripcion s
              WHERE s.SuscripcionEstado <> 'C'
              GROUP BY s.ClienteId
           ) u
          WHERE EXTRACT(YEAR FROM u.primera)::int = ?
            AND EXTRACT(MONTH FROM u.primera)::int = ?`,
        [a, m]
      );
      // Bajas: PERSONAS cuya ultima cobertura termina en el mes.
      //
      // Se usa el MAX de la fecha de fin por cliente, y eso resuelve dos
      // problemas de la version anterior (que contaba suscripciones
      // vencidas y no retenidas):
      //
      //   * Suscripciones SOLAPADAS: un socio con un plan que vence en abril
      //     y otro corriendo hasta junio no se fue del gimnasio, pero
      //     figuraba como baja de abril. El mismo response lo mostraba como
      //     activo y como baja a la vez.
      //   * Unidades: `altas` cuenta personas, asi que `bajas` tenia que
      //     contar personas o el neto (altas - bajas) no significaba nada.
      //
      // Como es el MAX, no puede existir ninguna suscripcion posterior de ese
      // cliente, asi que no hace falta chequear la ventana de gracia aca: si
      // su ultima cobertura termino en el mes, hoy no esta. La gracia sigue
      // importando para marcar el mes como provisorio.
      const bajas = await escalar(
        `SELECT COUNT(*)::int AS total
           FROM (
             SELECT s.ClienteId, MAX(DATE(s.SuscripcionFechaFin)) AS ultima
               FROM suscripcion s
              WHERE s.SuscripcionEstado <> 'C'
              GROUP BY s.ClienteId
           ) u
          WHERE EXTRACT(YEAR FROM u.ultima)::int = ?
            AND EXTRACT(MONTH FROM u.ultima)::int = ?`,
        [a, m]
      );
      // Renovaciones: el complemento de las altas sobre el mismo universo.
      const renovaciones = await escalar(
        `SELECT COUNT(*)::int AS total
           FROM suscripcion s
          WHERE s.SuscripcionEstado <> 'C'
            AND EXTRACT(YEAR FROM s.SuscripcionFechaInicio)::int = ?
            AND EXTRACT(MONTH FROM s.SuscripcionFechaInicio)::int = ?
            AND EXISTS (
              SELECT 1 FROM suscripcion p
               WHERE p.ClienteId = s.ClienteId
                 AND (p.SuscripcionFechaInicio, p.SuscripcionId)
                     < (s.SuscripcionFechaInicio, s.SuscripcionId)
            )`,
        [a, m]
      );
      // Vencidas del mes, sin las canceladas (esas se cuentan aparte para no
      // mezclar "se le vencio y no volvio" con "se dio de baja").
      const vencidas = await escalar(
        `SELECT COUNT(*)::int AS total
           FROM suscripcion s
          WHERE s.SuscripcionEstado <> 'C'
            AND EXTRACT(YEAR FROM s.SuscripcionFechaFin)::int = ?
            AND EXTRACT(MONTH FROM s.SuscripcionFechaFin)::int = ?`,
        [a, m]
      );
      // Retenidas: hay otra suscripcion que arranca dentro de la gracia.
      const retenidas = await escalar(
        `SELECT COUNT(*)::int AS total
           FROM suscripcion s
          WHERE s.SuscripcionEstado <> 'C'
            AND EXTRACT(YEAR FROM s.SuscripcionFechaFin)::int = ?
            AND EXTRACT(MONTH FROM s.SuscripcionFechaFin)::int = ?
            AND EXISTS (
              SELECT 1 FROM suscripcion n
               WHERE n.ClienteId = s.ClienteId
                 AND n.SuscripcionId <> s.SuscripcionId
                 AND n.SuscripcionEstado <> 'C'
                 AND DATE(n.SuscripcionFechaInicio) > DATE(s.SuscripcionFechaFin)
                 AND DATE(n.SuscripcionFechaInicio)
                     <= DATE(s.SuscripcionFechaFin) + (? || ' days')::interval
            )`,
        [a, m, diasGracia]
      );
      // Canceladas: solo las que ARRANCARON ANTES del mes.
      //
      // Una suscripcion dada de alta y cancelada dentro del mismo mes nunca
      // se conto como alta (las canceladas estan excluidas arriba), asi que
      // tampoco puede contar como baja: seria una baja fantasma de un socio
      // que en los numeros nunca entro. Tipicamente es un alta cargada por
      // error y anulada enseguida.
      //
      // En cambio cancelar una suscripcion que venia de meses anteriores si
      // es una baja: ese socio se conto como alta en su momento.
      const canceladas = await escalar(
        `SELECT COUNT(*)::int AS total
           FROM suscripcion s
          WHERE s.SuscripcionEstado = 'C'
            AND EXTRACT(YEAR FROM s.SuscripcionFechaFin)::int = ?
            AND EXTRACT(MONTH FROM s.SuscripcionFechaFin)::int = ?
            AND DATE(s.SuscripcionFechaInicio) < make_date(?, ?, 1)`,
        [a, m, a, m]
      );
      // Socios distintos con suscripcion vigente el ultimo dia del mes.
      const activosFin = await escalar(
        `SELECT COUNT(DISTINCT s.ClienteId)::int AS total
           FROM suscripcion s
          WHERE s.SuscripcionEstado NOT IN ('C', 'S')
            AND DATE(s.SuscripcionFechaInicio) <= (
                  (make_date(?, ?, 1) + INTERVAL '1 month - 1 day')::date
                )
            AND DATE(s.SuscripcionFechaFin) >= (
                  (make_date(?, ?, 1) + INTERVAL '1 month - 1 day')::date
                )`,
        [a, m, a, m]
      );

      return {
        altas,
        bajas,
        renovaciones,
        vencidas,
        retenidas,
        canceladas,
        activosFin,
      };
    }

    // El mes es PROVISORIO mientras alguna suscripcion que vencio en el mes
    // siga dentro de su ventana de gracia: todavia puede renovar y pasar de
    // baja a retenida.
    const [{ provisorio }] = await queryAsync(
      `SELECT EXISTS (
         SELECT 1 FROM suscripcion s
          WHERE s.SuscripcionEstado <> 'C'
            AND EXTRACT(YEAR FROM s.SuscripcionFechaFin)::int = ?
            AND EXTRACT(MONTH FROM s.SuscripcionFechaFin)::int = ?
            AND DATE(s.SuscripcionFechaFin) + (? || ' days')::interval
                >= CURRENT_DATE
       ) AS provisorio`,
      [anio, mes, diasGracia]
    );

    const previo = mesAnterior(anio, mes);
    const [actual, anterior] = await Promise.all([
      contarMes(anio, mes),
      contarMes(previo.anio, previo.mes),
    ]);

    res.json({
      anio,
      mes,
      mesAnteriorRef: previo,
      ...armarCrecimiento({ actual, anterior, diasGracia, provisorio }),
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};
