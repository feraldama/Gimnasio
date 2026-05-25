const { CanchaTarifa, siglaDia } = require("../models/canchaTarifa.model");
const Cancha = require("../models/cancha.model");
const db = require("../config/db");
const { sendError } = require("../utils/errors");

// Parsea "HH:MM" o "HH:MM:SS" → minutos desde medianoche.
function hhmmToMinutes(s) {
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + (m || 0);
}

exports.listByCancha = async (req, res) => {
  try {
    const data = await CanchaTarifa.getByCancha(req.params.canchaId);
    res.json({ data });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const t = await CanchaTarifa.getById(req.params.id);
    if (!t) return res.status(404).json({ message: "Tarifa no encontrada" });
    res.json(t);
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.create = async (req, res) => {
  try {
    if (!req.body.CanchaId) {
      return res
        .status(400)
        .json({ success: false, message: "CanchaId es requerido" });
    }
    if (
      req.body.CanchaTarifaHoraHasta &&
      req.body.CanchaTarifaHoraDesde &&
      req.body.CanchaTarifaHoraHasta <= req.body.CanchaTarifaHoraDesde
    ) {
      return res.status(400).json({
        success: false,
        message: "La hora 'hasta' debe ser posterior a 'desde'.",
      });
    }
    const t = await CanchaTarifa.create(req.body);
    res.status(201).json({ success: true, data: t });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.update = async (req, res) => {
  try {
    if (
      req.body.CanchaTarifaHoraHasta &&
      req.body.CanchaTarifaHoraDesde &&
      req.body.CanchaTarifaHoraHasta <= req.body.CanchaTarifaHoraDesde
    ) {
      return res.status(400).json({
        success: false,
        message: "La hora 'hasta' debe ser posterior a 'desde'.",
      });
    }
    const t = await CanchaTarifa.update(req.params.id, req.body);
    if (!t) return res.status(404).json({ message: "Tarifa no encontrada" });
    res.json({ success: true, data: t });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.remove = async (req, res) => {
  try {
    const ok = await CanchaTarifa.delete(req.params.id);
    if (!ok) return res.status(404).json({ message: "Tarifa no encontrada" });
    res.json({ success: true });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// Sugiere monto para una reserva. Iterando slots de 30 min, cada slot va a la
// banda aplicable (o al precio flat de la cancha si no hay banda). Suma el
// precio horario × 0.5 por cada slot.
//
// Antes la sugerencia tomaba solo la banda de horaInicio y multiplicaba por
// la duración entera — eso ignoraba cambios de banda mediante la reserva. Ej:
// reserva 17–19h con "diurna 06–18 Gs.50k" y "nocturna 18–23 Gs.80k"
// sugería 50k × 2 = 100k cuando lo correcto es 50k + 80k = 130k.
//
// Body esperado: { canchaId, fecha, horaInicio: "HH:MM", horaFin: "HH:MM" }
exports.sugerirMonto = async (req, res) => {
  try {
    const { canchaId, fecha, horaInicio, horaFin } = req.body || {};
    if (!canchaId || !fecha || !horaInicio || !horaFin) {
      return res
        .status(400)
        .json({ message: "canchaId, fecha, horaInicio y horaFin son requeridos" });
    }
    const minIni = hhmmToMinutes(horaInicio);
    const minFin = hhmmToMinutes(horaFin);
    if (minFin <= minIni) {
      return res.status(400).json({ message: "Rango horario inválido" });
    }
    const duracionH = (minFin - minIni) / 60;

    // Día de semana (L/M/X/J/V/S/D) calculado en zona local sin saltos UTC.
    const [y, m, d] = String(fecha).split("T")[0].split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dia = siglaDia(date);

    // Traer TODAS las bandas activas que aplican al día, ordenadas por
    // prioridad DESC. El matcheo por slot se hace en memoria (sin queries
    // por slot) para que reservas largas no escalen lineal en queries.
    const bandas = await new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM cancha_tarifa
         WHERE CanchaId = ?
           AND CanchaTarifaActiva = 1
           AND CanchaTarifaDiasSemana LIKE ?
         ORDER BY CanchaTarifaPrioridad DESC, CanchaTarifaId DESC`,
        [canchaId, `%${dia}%`],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    // Pre-procesar bandas con sus límites en minutos (más barato que parsear
    // en cada slot).
    const bandasMin = bandas.map((b) => ({
      banda: b,
      desde: hhmmToMinutes(b.CanchaTarifaHoraDesde),
      hasta: hhmmToMinutes(b.CanchaTarifaHoraHasta),
    }));
    const bandaParaMin = (min) => {
      for (const x of bandasMin) {
        if (x.desde <= min && min < x.hasta) return x.banda;
      }
      return null;
    };

    const cancha = await Cancha.getById(canchaId);
    const precioFallback = Number(cancha?.CanchaTarifaHora || 0);

    // Acumular: monto total + tracking de qué bandas se usaron (para el
    // desglose que devolvemos al frontend).
    const usadas = new Map();
    let slotsFallback = 0;
    let monto = 0;

    for (let cursor = minIni; cursor < minFin; cursor += 30) {
      const b = bandaParaMin(cursor);
      if (b) {
        monto += Number(b.CanchaTarifaPrecio) * 0.5;
        const entry = usadas.get(b.CanchaTarifaId) || { banda: b, slots: 0 };
        entry.slots += 1;
        usadas.set(b.CanchaTarifaId, entry);
      } else {
        monto += precioFallback * 0.5;
        slotsFallback += 1;
      }
    }
    monto = Math.round(monto);

    // Decidir `fuente` y shape compatible con el frontend.
    //  - Una sola banda usada (y sin fallback): igual que antes, fuente=BANDA.
    //  - Ninguna banda matcheó: FLAT_CANCHA o SIN_TARIFA (mismo flujo viejo).
    //  - Mixto (>1 banda, o banda + fallback): nuevo fuente=MIXTA con
    //    `bandas[]` desglosado por horas.
    if (usadas.size === 1 && slotsFallback === 0) {
      const unica = [...usadas.values()][0].banda;
      return res.json({
        monto,
        duracionHoras: duracionH,
        banda: {
          CanchaTarifaId: unica.CanchaTarifaId,
          nombre: unica.CanchaTarifaNombre,
          precio: Number(unica.CanchaTarifaPrecio),
        },
        fuente: "BANDA",
      });
    }
    if (usadas.size === 0) {
      return res.json({
        monto,
        duracionHoras: duracionH,
        banda: null,
        fuente: precioFallback > 0 ? "FLAT_CANCHA" : "SIN_TARIFA",
      });
    }
    // Mixto: armar desglose para que el frontend lo muestre.
    const desglose = [...usadas.values()].map(({ banda, slots }) => ({
      CanchaTarifaId: banda.CanchaTarifaId,
      nombre: banda.CanchaTarifaNombre,
      precio: Number(banda.CanchaTarifaPrecio),
      horas: slots * 0.5,
    }));
    if (slotsFallback > 0) {
      desglose.push({
        CanchaTarifaId: 0,
        nombre: "Tarifa flat",
        precio: precioFallback,
        horas: slotsFallback * 0.5,
      });
    }
    return res.json({
      monto,
      duracionHoras: duracionH,
      banda: null,
      bandas: desglose,
      fuente: "MIXTA",
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};
