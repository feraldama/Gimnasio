const CanchaBloqueo = require("../models/canchaBloqueo.model");
const { sendError } = require("../utils/errors");

// HH:MM o HH:MM:SS → minutos desde medianoche. null/undefined → null.
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}

// ¿Un bloqueo aplica a un rango horario dado? Comparamos en minutos para no
// pelearnos con strings tipo "08:00" vs "08:00:00".
//
// Reglas:
//   - bloqueo sin horarios (NULL) ⇒ todo el día ⇒ siempre aplica.
//   - rango bloqueo [bd, bh) solapa con rango reserva [rd, rh) si: bd < rh && bh > rd.
//
// Exportada para que canchaReserva.controller la use al verificar conflictos.
function bloqueoSolapaConHorario(bloqueo, horaInicio, horaFin) {
  const bd = timeToMin(bloqueo.CanchaBloqueoHoraDesde);
  const bh = timeToMin(bloqueo.CanchaBloqueoHoraHasta);
  if (bd === null || bh === null) return true; // todo el día
  const rd = timeToMin(horaInicio);
  const rh = timeToMin(horaFin);
  if (rd === null || rh === null) return false;
  return bd < rh && bh > rd;
}

// Devuelve el primer bloqueo aplicable a (cancha, fecha, horario) o null.
// Usado por verificarConflictoTx en canchaReserva.controller.
async function bloqueoAplicable(canchaId, fecha, horaInicio, horaFin) {
  const bloqueos = await CanchaBloqueo.getAplicables(canchaId, fecha);
  for (const b of bloqueos) {
    if (bloqueoSolapaConHorario(b, horaInicio, horaFin)) return b;
  }
  return null;
}

exports.listByRango = async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res
        .status(400)
        .json({ message: "Parámetros `desde` y `hasta` son requeridos (YYYY-MM-DD)" });
    }
    const data = await CanchaBloqueo.listByRango(desde, hasta);
    res.json({ data });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const b = await CanchaBloqueo.getById(req.params.id);
    if (!b) return res.status(404).json({ message: "Bloqueo no encontrado" });
    res.json(b);
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.create = async (req, res) => {
  try {
    if (!req.body.CanchaBloqueoFecha) {
      return res
        .status(400)
        .json({ success: false, message: "CanchaBloqueoFecha es requerido" });
    }
    // Si vienen horarios parciales (uno sí, otro no), exigir los dos para que
    // el solape sea bien definido.
    const hd = req.body.CanchaBloqueoHoraDesde;
    const hh = req.body.CanchaBloqueoHoraHasta;
    if ((hd && !hh) || (!hd && hh)) {
      return res.status(400).json({
        success: false,
        message:
          "Si se especifica horario, hora desde y hasta deben venir juntas (dejar ambas vacías = todo el día).",
      });
    }
    if (hd && hh && hh <= hd) {
      return res.status(400).json({
        success: false,
        message: "La hora 'hasta' debe ser posterior a 'desde'.",
      });
    }
    const b = await CanchaBloqueo.create({
      ...req.body,
      UsuarioId: req.user?.id || req.body.UsuarioId || null,
    });
    res.status(201).json({ success: true, data: b });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.update = async (req, res) => {
  try {
    const hd = req.body.CanchaBloqueoHoraDesde;
    const hh = req.body.CanchaBloqueoHoraHasta;
    if ((hd && !hh) || (!hd && hh)) {
      return res.status(400).json({
        success: false,
        message:
          "Si se especifica horario, hora desde y hasta deben venir juntas.",
      });
    }
    if (hd && hh && hh <= hd) {
      return res.status(400).json({
        success: false,
        message: "La hora 'hasta' debe ser posterior a 'desde'.",
      });
    }
    const b = await CanchaBloqueo.update(req.params.id, req.body);
    if (!b) return res.status(404).json({ message: "Bloqueo no encontrado" });
    res.json({ success: true, data: b });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.remove = async (req, res) => {
  try {
    const ok = await CanchaBloqueo.delete(req.params.id);
    if (!ok) return res.status(404).json({ message: "Bloqueo no encontrado" });
    res.json({ success: true });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// Helpers exportados (los usa canchaReserva.controller).
module.exports.bloqueoAplicable = bloqueoAplicable;
module.exports.bloqueoSolapaConHorario = bloqueoSolapaConHorario;
