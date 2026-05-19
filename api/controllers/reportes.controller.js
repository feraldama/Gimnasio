// Controllers para los 3 reportes graficos pedidos por el cliente
// (ver migracion 002 y el whiteboard).
//
// Cada endpoint devuelve un arreglo listo para graficar; el frontend solo lo
// pinta. Los parametros `anio` y `mes` se asumen del calendario gregoriano.

const db = require("../config/db");
const Configuracion = require("../models/configuracion.model");
const CanchaReserva = require("../models/canchaReserva.model");
const { sendError } = require("../utils/errors");

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

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

// Mapea un dia (1-31) a la semana del mes con bucketing fijo:
//   dias 1-7   -> 1, 8-14 -> 2, 15-21 -> 3, 22-fin -> 4
// Esto da exactamente 4 buckets sin importar el largo del mes, que es lo que
// el cliente dibujo en la pizarra (S1..S4).
function semanaDelMes(dia) {
  if (dia <= 7) return 1;
  if (dia <= 14) return 2;
  if (dia <= 21) return 3;
  return 4;
}

// ============================================================
// GIMNASIO - Reporte de ocupacion mensual (S1..S4)
// ============================================================
// Cuenta inscripciones (suscripcion.SuscripcionFechaInicio) cayendo en cada
// semana del mes y calcula la tasa acumulada respecto de R (capacidad).
exports.gimnasioOcupacion = async (req, res) => {
  try {
    const { anio, mes, error } = parseAnioMes(req);
    if (error) return res.status(400).json({ error });

    const R = await Configuracion.getNumero(
      "GIMNASIO_CAPACIDAD_MENSUAL",
      250
    );

    const sql = `
      SELECT EXTRACT(DAY FROM SuscripcionFechaInicio)::int AS dia,
             COUNT(*)::int AS inscriptos
      FROM suscripcion
      WHERE EXTRACT(YEAR FROM SuscripcionFechaInicio)::int = ?
        AND EXTRACT(MONTH FROM SuscripcionFechaInicio)::int = ?
        AND SuscripcionEstado <> 'C'
      GROUP BY dia
    `;
    db.query(sql, [anio, mes], (err, rows) => {
      if (err) return sendError(res, err, 500);
      const semanas = [0, 0, 0, 0];
      for (const r of rows) {
        const s = semanaDelMes(r.dia);
        semanas[s - 1] += r.inscriptos;
      }
      let acumulado = 0;
      const data = semanas.map((isr, i) => {
        acumulado += isr;
        return {
          semana: `S${i + 1}`,
          inscriptos: isr,
          acumulado,
          capacidad: R,
          ocupacionPct: R > 0 ? Number(((acumulado / R) * 100).toFixed(2)) : 0,
        };
      });
      res.json({
        anio,
        mes,
        capacidad: R,
        data,
        totalInscriptos: acumulado,
        ocupacionFinalPct: R > 0 ? Number(((acumulado / R) * 100).toFixed(2)) : 0,
      });
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// ============================================================
// CANCHA - Reporte de ingreso diario (D1..D30)
// ============================================================
exports.canchaDiario = async (req, res) => {
  try {
    const { anio, mes, error } = parseAnioMes(req);
    if (error) return res.status(400).json({ error });

    const meta = await Configuracion.getNumero("CANCHA_META_DIARIA", 800000);

    const rows = await CanchaReserva.ingresoPorDia(anio, mes);
    const dias = diasEnMes(anio, mes);
    const porDia = new Map(rows.map((r) => [r.dia, r]));
    const data = [];
    let totalIngreso = 0;
    let diasConIngreso = 0;
    for (let d = 1; d <= dias; d++) {
      const r = porDia.get(d);
      const ingreso = r ? Number(r.ingreso) : 0;
      const reservas = r ? r.reservas : 0;
      totalIngreso += ingreso;
      if (ingreso > 0) diasConIngreso++;
      data.push({
        dia: d,
        etiqueta: `D${d}`,
        ingreso,
        reservas,
        meta,
        cumplimientoPct: meta > 0 ? Number(((ingreso / meta) * 100).toFixed(2)) : 0,
      });
    }
    res.json({
      anio,
      mes,
      meta,
      data,
      totalIngreso,
      diasConIngreso,
      promedioDiario:
        diasConIngreso > 0 ? Math.round(totalIngreso / diasConIngreso) : 0,
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// ============================================================
// CANTINA - Reporte de rotacion diaria
// ============================================================
// Formula del whiteboard:
//   D_n = $Recaudada / ($I + Stock($))  (al cierre)
// donde:
//   $Recaudada = suma de ventas del dia
//   $I         = efectivo en caja al cierre (saldo final de movimientos)
//   Stock($)   = valor monetario del stock (sum(stock * precio_promedio))
//
// Para dias pasados Stock($) se aproxima con el snapshot actual de stock —
// reconstruir el inventario historico requiere recorrer compras/ventas y
// queda fuera del alcance de esta primera version.
exports.cantinaDiario = async (req, res) => {
  try {
    const { anio, mes, error } = parseAnioMes(req);
    if (error) return res.status(400).json({ error });

    // Recaudado por dia (todas las ventas, no solo CO).
    const sqlVentas = `
      SELECT EXTRACT(DAY FROM VentaFecha)::int AS dia,
             COALESCE(SUM(Total), 0)::bigint AS recaudado,
             COUNT(*)::int AS cantidad
      FROM venta
      WHERE EXTRACT(YEAR FROM VentaFecha)::int = ?
        AND EXTRACT(MONTH FROM VentaFecha)::int = ?
      GROUP BY dia
    `;
    // Saldo de caja al cierre del dia: sum de movimientos del dia (positivos
    // y negativos segun TipoGastoGrupoId). Usamos el monto neto del dia como
    // proxy de "efectivo del dia"; si el cliente quiere saldo acumulado real
    // se puede ajustar despues.
    const sqlCaja = `
      SELECT EXTRACT(DAY FROM RegistroDiarioCajaFecha)::int AS dia,
             COALESCE(SUM(RegistroDiarioCajaMonto), 0)::bigint AS efectivo
      FROM registrodiariocaja
      WHERE EXTRACT(YEAR FROM RegistroDiarioCajaFecha)::int = ?
        AND EXTRACT(MONTH FROM RegistroDiarioCajaFecha)::int = ?
      GROUP BY dia
    `;
    // Valor del stock (snapshot actual).
    const sqlStock = `
      SELECT COALESCE(SUM(ProductoStock * ProductoPrecioPromedio), 0)::bigint AS valorstock
      FROM producto
      WHERE ProductoStock > 0
    `;

    const queryAsync = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });

    const [ventasRows, cajaRows, stockRows] = await Promise.all([
      queryAsync(sqlVentas, [anio, mes]),
      queryAsync(sqlCaja, [anio, mes]),
      queryAsync(sqlStock, []),
    ]);
    const valorStockActual = Number(stockRows[0]?.valorstock || 0);

    const ventasPorDia = new Map(ventasRows.map((r) => [r.dia, r]));
    const cajaPorDia = new Map(cajaRows.map((r) => [r.dia, r]));
    const dias = diasEnMes(anio, mes);

    const data = [];
    let totalRecaudado = 0;
    for (let d = 1; d <= dias; d++) {
      const v = ventasPorDia.get(d);
      const c = cajaPorDia.get(d);
      const recaudado = v ? Number(v.recaudado) : 0;
      const cantidadVentas = v ? v.cantidad : 0;
      const efectivo = c ? Number(c.efectivo) : 0;
      totalRecaudado += recaudado;
      const denominador = efectivo + valorStockActual;
      const rotacionPct =
        denominador > 0
          ? Number(((recaudado / denominador) * 100).toFixed(2))
          : 0;
      data.push({
        dia: d,
        etiqueta: `D${d}`,
        recaudado,
        cantidadVentas,
        efectivo,
        valorStock: valorStockActual,
        rotacionPct,
      });
    }

    res.json({
      anio,
      mes,
      valorStockActual,
      data,
      totalRecaudado,
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};
