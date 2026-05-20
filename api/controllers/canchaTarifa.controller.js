const { CanchaTarifa } = require("../models/canchaTarifa.model");
const Cancha = require("../models/cancha.model");
const { sendError } = require("../utils/errors");

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

// Sugiere monto para una reserva: busca la banda aplicable a la hora de
// inicio de la reserva y multiplica por la duración. Si ninguna banda matchea
// devuelve el fallback de cancha.CanchaTarifaHora * duración.
//
// Body esperado:
//   { canchaId, fecha, horaInicio: "HH:MM", horaFin: "HH:MM" }
exports.sugerirMonto = async (req, res) => {
  try {
    const { canchaId, fecha, horaInicio, horaFin } = req.body || {};
    if (!canchaId || !fecha || !horaInicio || !horaFin) {
      return res.status(400).json({
        message:
          "canchaId, fecha, horaInicio y horaFin son requeridos",
      });
    }
    // Duración en horas (decimal). Asume horaFin > horaInicio en el mismo día.
    const [hi, mi] = horaInicio.split(":").map(Number);
    const [hf, mf] = horaFin.split(":").map(Number);
    const minutos = hf * 60 + mf - (hi * 60 + mi);
    if (minutos <= 0) {
      return res.status(400).json({ message: "Rango horario inválido" });
    }
    const duracionH = minutos / 60;

    const banda = await CanchaTarifa.bandaAplicable(canchaId, fecha, horaInicio);
    if (banda) {
      const monto = Math.round(Number(banda.CanchaTarifaPrecio) * duracionH);
      return res.json({
        monto,
        duracionHoras: duracionH,
        banda: {
          CanchaTarifaId: banda.CanchaTarifaId,
          nombre: banda.CanchaTarifaNombre,
          precio: Number(banda.CanchaTarifaPrecio),
        },
        fuente: "BANDA",
      });
    }
    // Fallback: tarifa flat de cancha.
    const c = await Cancha.getById(canchaId);
    const precioFallback = Number(c?.CanchaTarifaHora || 0);
    const monto = Math.round(precioFallback * duracionH);
    return res.json({
      monto,
      duracionHoras: duracionH,
      banda: null,
      fuente: precioFallback > 0 ? "FLAT_CANCHA" : "SIN_TARIFA",
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};
