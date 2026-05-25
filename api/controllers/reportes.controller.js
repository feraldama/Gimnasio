// Controllers para los 3 reportes graficos pedidos por el cliente
// (ver migracion 002 y el whiteboard).
//
// Cada endpoint devuelve un arreglo listo para graficar; el frontend solo lo
// pinta. Los parametros `anio` y `mes` se asumen del calendario gregoriano.

const db = require("../config/db");
const Configuracion = require("../models/configuracion.model");
const CanchaReserva = require("../models/canchaReserva.model");
const { CanchaTarifa, siglaDia } = require("../models/canchaTarifa.model");
const { sendError } = require("../utils/errors");

// Horario operativo de Cancha: configurable via `configuracion`. Defaults
// pensados como horario tipico de un gym/club paraguayo. Leer las claves
// vivas en cada request para que un cambio en Ajustes impacte sin reiniciar.
async function obtenerHorarioOperativo() {
  const inicio = await Configuracion.getNumero("CANCHA_HORA_INICIO", 6);
  const fin = await Configuracion.getNumero("CANCHA_HORA_FIN", 23);
  // Sanity: si configuran mal (fin <= inicio) volvemos al default.
  if (fin <= inicio) return { inicio: 6, fin: 23, horasPorDia: 17 };
  return { inicio, fin, horasPorDia: fin - inicio };
}

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

// ============================================================
// CANCHA - Heatmap día de semana × hora (horas pico)
// ============================================================
// Cuenta reservas activas por (día de semana × hora) para detectar bandas
// pico. Día 0 = Lunes, 6 = Domingo (matchea con el orden visual del cliente).
// `horaInicio`/`horaFin` vienen del horario operativo configurado.
exports.canchaHeatmap = async (req, res) => {
  try {
    const { anio, mes, error } = parseAnioMes(req);
    if (error) return res.status(400).json({ error });
    const canchaIdFiltro = req.query.canchaId
      ? parseInt(req.query.canchaId, 10)
      : null;
    const horario = await obtenerHorarioOperativo();

    const queryAsync = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });

    const sqlParams = [anio, mes];
    let sql = `
      SELECT r.CanchaReservaFecha,
             CAST(r.CanchaReservaHoraInicio AS TEXT) AS hora_inicio_txt,
             CAST(r.CanchaReservaHoraFin AS TEXT) AS hora_fin_txt,
             r.CanchaReservaEstado,
             r.CanchaReservaMonto
      FROM cancha_reserva r
      WHERE EXTRACT(YEAR FROM r.CanchaReservaFecha)::int = ?
        AND EXTRACT(MONTH FROM r.CanchaReservaFecha)::int = ?
        AND r.CanchaReservaEstado <> 'X'
    `;
    if (canchaIdFiltro) {
      sql += " AND r.CanchaId = ?";
      sqlParams.push(canchaIdFiltro);
    }
    const rows = await queryAsync(sql, sqlParams);

    // Matriz 7 (días) × N (horas). Usamos día 0=Lun para alinear con UI.
    const horas = [];
    for (let h = horario.inicio; h < horario.fin; h++) horas.push(h);
    // celdas: Map "dia-hora" → { reservas, ingreso }
    const celdas = new Map();
    let totalReservas = 0;
    let totalIngreso = 0;

    for (const r of rows) {
      const fechaStr = String(r.CanchaReservaFecha).split("T")[0];
      const [yy, mm, dd] = fechaStr.split("-").map(Number);
      const dt = new Date(yy, mm - 1, dd);
      // 0=Dom..6=Sab → mapeamos a 0=Lun..6=Dom
      const diaJS = dt.getDay();
      const dia = diaJS === 0 ? 6 : diaJS - 1;
      const hi = String(r.hora_inicio_txt || "").slice(11, 13);
      const hora = parseInt(hi, 10);
      if (!Number.isFinite(hora)) continue;
      // Solo contamos si entra en el horario operativo
      if (hora < horario.inicio || hora >= horario.fin) continue;
      const k = `${dia}-${hora}`;
      if (!celdas.has(k)) celdas.set(k, { reservas: 0, ingreso: 0 });
      const c = celdas.get(k);
      c.reservas += 1;
      c.ingreso += Number(r.CanchaReservaMonto || 0);
      totalReservas++;
      totalIngreso += Number(r.CanchaReservaMonto || 0);
    }

    // Construir matriz completa
    const matriz = [];
    for (let dia = 0; dia < 7; dia++) {
      for (const hora of horas) {
        const c = celdas.get(`${dia}-${hora}`) || { reservas: 0, ingreso: 0 };
        matriz.push({ dia, hora, reservas: c.reservas, ingreso: c.ingreso });
      }
    }

    // Top 5 horas pico
    const top = matriz
      .filter((c) => c.reservas > 0)
      .sort((a, b) => b.reservas - a.reservas)
      .slice(0, 5);

    // Total por día (para mostrar día más activo)
    const porDia = Array.from({ length: 7 }, (_, d) => {
      const reservas = matriz
        .filter((c) => c.dia === d)
        .reduce((a, c) => a + c.reservas, 0);
      const ingreso = matriz
        .filter((c) => c.dia === d)
        .reduce((a, c) => a + c.ingreso, 0);
      return { dia: d, reservas, ingreso };
    });

    res.json({
      anio,
      mes,
      horario,
      horas,
      matriz,
      top,
      porDia,
      totales: { reservas: totalReservas, ingreso: totalIngreso },
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// ============================================================
// CANCHA - Desglose mensual (por cancha + por banda + ocupación)
// ============================================================
// Para cada reserva PAGADA del mes determinamos la banda de tarifa que se
// le habría aplicado (matcheo por día de semana + hora de inicio) y
// agrupamos. La banda se evalúa para fines de reporte aunque la reserva
// pueda haberse cobrado con un monto manual.
exports.canchaDesglose = async (req, res) => {
  try {
    const { anio, mes, error } = parseAnioMes(req);
    if (error) return res.status(400).json({ error });
    // Filtro opcional: cuando llega ?canchaId=N restringimos canchas y reservas
    // a esa sola. Sirve para drillear el reporte por cancha individual.
    const canchaIdFiltro = req.query.canchaId
      ? parseInt(req.query.canchaId, 10)
      : null;

    const queryAsync = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });

    // Canchas (todas o solo la filtrada).
    const canchas = canchaIdFiltro
      ? await queryAsync(
          "SELECT CanchaId, CanchaNombre, CanchaActiva FROM cancha WHERE CanchaId = ? ORDER BY CanchaId",
          [canchaIdFiltro]
        )
      : await queryAsync(
          "SELECT CanchaId, CanchaNombre, CanchaActiva FROM cancha ORDER BY CanchaId",
          []
        );

    // Reservas del mes (opcionalmente filtradas por cancha).
    const reservasParams = [anio, mes];
    let sqlReservas = `
      SELECT r.CanchaReservaId,
             r.CanchaId,
             r.CanchaReservaEstado,
             r.CanchaReservaMonto,
             r.CanchaReservaFecha,
             CAST(r.CanchaReservaHoraInicio AS TEXT) AS hora_inicio_txt,
             CAST(r.CanchaReservaHoraFin AS TEXT) AS hora_fin_txt
      FROM cancha_reserva r
      WHERE EXTRACT(YEAR FROM r.CanchaReservaFecha)::int = ?
        AND EXTRACT(MONTH FROM r.CanchaReservaFecha)::int = ?
    `;
    if (canchaIdFiltro) {
      sqlReservas += " AND r.CanchaId = ?";
      reservasParams.push(canchaIdFiltro);
    }
    sqlReservas += " ORDER BY r.CanchaReservaFecha, r.CanchaReservaHoraInicio";
    const reservas = await queryAsync(sqlReservas, reservasParams);

    // Cache de tarifas por cancha (las traemos una vez).
    const tarifasPorCancha = new Map();
    for (const c of canchas) {
      const ts = await CanchaTarifa.getByCancha(c.CanchaId);
      tarifasPorCancha.set(c.CanchaId, ts.filter((t) => t.CanchaTarifaActiva === 1));
    }

    // Helper: dada una reserva, devuelve la banda aplicable (la de mayor
    // prioridad cuyo día + hora inicio matchee). Si ninguna matchea
    // devuelve null (fallback: "Sin banda" en el desglose).
    function bandaParaReserva(r) {
      const tarifas = tarifasPorCancha.get(r.CanchaId) || [];
      if (!tarifas.length) return null;
      const fechaStr = String(r.CanchaReservaFecha).split("T")[0];
      const [y, m, d] = fechaStr.split("-").map(Number);
      const dia = siglaDia(new Date(y, m - 1, d));
      const hi = (r.hora_inicio_txt || "").slice(11, 16); // "HH:MM"
      let mejor = null;
      for (const t of tarifas) {
        const desde = String(t.CanchaTarifaHoraDesde).slice(0, 5);
        const hasta = String(t.CanchaTarifaHoraHasta).slice(0, 5);
        if (!t.CanchaTarifaDiasSemana.includes(dia)) continue;
        if (hi < desde || hi >= hasta) continue;
        if (!mejor || t.CanchaTarifaPrioridad > mejor.CanchaTarifaPrioridad) {
          mejor = t;
        }
      }
      return mejor;
    }

    // Helper: duración en horas desde dos strings "YYYY-MM-DD HH:MM:SS".
    function duracionHoras(hi, hf) {
      if (!hi || !hf) return 0;
      const a = hi.slice(11, 16);
      const b = hf.slice(11, 16);
      const [ah, am] = a.split(":").map(Number);
      const [bh, bm] = b.split(":").map(Number);
      const minutos = bh * 60 + bm - (ah * 60 + am);
      return minutos > 0 ? minutos / 60 : 0;
    }

    // Agregaciones.
    const porCancha = new Map();
    const porBanda = new Map();
    let totalIngreso = 0;
    let totalReservas = 0;
    let totalHorasOcupadas = 0;

    for (const r of reservas) {
      if (r.CanchaReservaEstado === "X") continue; // canceladas no cuentan
      const monto = Number(r.CanchaReservaMonto || 0);
      const horas = duracionHoras(r.hora_inicio_txt, r.hora_fin_txt);

      // Por cancha
      if (!porCancha.has(r.CanchaId)) {
        const cInfo = canchas.find((c) => c.CanchaId === r.CanchaId);
        porCancha.set(r.CanchaId, {
          canchaId: r.CanchaId,
          canchaNombre: cInfo?.CanchaNombre || `Cancha ${r.CanchaId}`,
          ingreso: 0,
          reservas: 0,
          horasOcupadas: 0,
        });
      }
      const agg = porCancha.get(r.CanchaId);
      agg.ingreso += monto;
      agg.reservas += 1;
      agg.horasOcupadas += horas;

      // Por banda
      const banda = bandaParaReserva(r);
      const key = banda ? `B${banda.CanchaTarifaId}` : "SIN_BANDA";
      if (!porBanda.has(key)) {
        porBanda.set(key, {
          bandaId: banda?.CanchaTarifaId ?? null,
          nombre:
            banda?.CanchaTarifaNombre ||
            (banda ? `Banda ${banda.CanchaTarifaId}` : "Sin banda definida"),
          ingreso: 0,
          reservas: 0,
        });
      }
      const aggB = porBanda.get(key);
      aggB.ingreso += monto;
      aggB.reservas += 1;

      totalIngreso += monto;
      totalReservas += 1;
      totalHorasOcupadas += horas;
    }

    // Ocupación por cancha: horas reservadas / (horas operativas × días del mes)
    const horario = await obtenerHorarioOperativo();
    const dias = diasEnMes(anio, mes);
    const horasDisponiblesPorCancha = horario.horasPorDia * dias;
    const porCanchaArr = canchas.map((c) => {
      const agg = porCancha.get(c.CanchaId) || {
        canchaId: c.CanchaId,
        canchaNombre: c.CanchaNombre,
        ingreso: 0,
        reservas: 0,
        horasOcupadas: 0,
      };
      const ocupacionPct =
        horasDisponiblesPorCancha > 0
          ? Number(
              ((agg.horasOcupadas / horasDisponiblesPorCancha) * 100).toFixed(2)
            )
          : 0;
      return {
        ...agg,
        horasOcupadas: Number(agg.horasOcupadas.toFixed(2)),
        horasDisponibles: horasDisponiblesPorCancha,
        ocupacionPct,
      };
    });

    const porBandaArr = Array.from(porBanda.values())
      .map((b) => ({
        ...b,
        ingreso: Number(b.ingreso),
      }))
      .sort((a, b) => b.ingreso - a.ingreso);

    const totalHorasDisponibles = horasDisponiblesPorCancha * canchas.length;
    const ocupacionTotalPct =
      totalHorasDisponibles > 0
        ? Number(
            ((totalHorasOcupadas / totalHorasDisponibles) * 100).toFixed(2)
          )
        : 0;

    res.json({
      anio,
      mes,
      horario,
      totales: {
        ingreso: totalIngreso,
        reservas: totalReservas,
        horasOcupadas: Number(totalHorasOcupadas.toFixed(2)),
        horasDisponibles: totalHorasDisponibles,
        ocupacionPct: ocupacionTotalPct,
      },
      porCancha: porCanchaArr,
      porBanda: porBandaArr,
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// KPIs en vivo para el Dashboard de gimnasio. Reemplaza los valores hardcoded
// ("Usuarios totales: 25", etc.) por métricas reales calculadas al vuelo.
//
// - sociosActivos: clientes distintos con al menos una suscripción cuya
//   vigencia incluye hoy (recalculado por fechas, no por la columna
//   `SuscripcionEstado` que puede haber quedado obsoleta).
// - proximosAVencer7d: suscripciones activas con FechaFin entre hoy y hoy+7.
// - cobradoHoy: suma de PagoMonto del día.
// - asistenciasHoy: cantidad de ingresos registrados hoy.
//
// Una sola request al backend; en frontend reemplaza 4 StatCards.
exports.dashboardGimnasioKpis = async (_req, res) => {
  try {
    const queryAsync = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params || [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

    // Recalculamos vigencia por fechas, no por SuscripcionEstado, para no
    // depender de que la columna esté al día. C y S sí se respetan (son
    // estados manuales que no se recalculan).
    const [activosRow] = await queryAsync(
      `SELECT COUNT(DISTINCT ClienteId) AS n
       FROM suscripcion
       WHERE SuscripcionEstado NOT IN ('C', 'S')
         AND DATE(SuscripcionFechaInicio) <= CURRENT_DATE
         AND DATE(SuscripcionFechaFin) >= CURRENT_DATE`
    );

    const [proximosRow] = await queryAsync(
      `SELECT COUNT(*) AS n
       FROM suscripcion
       WHERE SuscripcionEstado NOT IN ('C', 'S')
         AND DATE(SuscripcionFechaFin) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`
    );

    const [cobradoRow] = await queryAsync(
      `SELECT COALESCE(SUM(PagoMonto), 0) AS total, COUNT(*) AS cant
       FROM pago
       WHERE DATE(PagoFecha) = CURRENT_DATE`
    );

    const [asistRow] = await queryAsync(
      `SELECT COUNT(*) AS n
       FROM asistencia
       WHERE DATE(AsistenciaFecha) = CURRENT_DATE`
    );

    res.json({
      sociosActivos: Number(activosRow?.n || 0),
      proximosAVencer7d: Number(proximosRow?.n || 0),
      cobradoHoy: Number(cobradoRow?.total || 0),
      cobrosHoy: Number(cobradoRow?.cant || 0),
      asistenciasHoy: Number(asistRow?.n || 0),
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};
