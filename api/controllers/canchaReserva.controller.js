const CanchaReserva = require("../models/canchaReserva.model");
const { sendError } = require("../utils/errors");

exports.getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "CanchaReservaFecha";
    const sortOrder = req.query.sortOrder || "DESC";
    const { reservas, total } = await CanchaReserva.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder
    );
    res.json({
      data: reservas,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    sendError(res, error, 500);
  }
};

exports.search = async (req, res) => {
  try {
    const { q: term } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    if (!term || term.trim() === "")
      return res
        .status(400)
        .json({ error: "El termino de busqueda no puede estar vacio" });
    const { reservas, total } = await CanchaReserva.search(term, limit, offset);
    res.json({
      data: reservas,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.getByRango = async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta)
      return res
        .status(400)
        .json({ error: "Los parámetros desde y hasta son requeridos" });
    const reservas = await CanchaReserva.getByRango(desde, hasta);
    res.json({ data: reservas });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.getByFecha = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha)
      return res.status(400).json({ error: "El parametro fecha es requerido" });
    const reservas = await CanchaReserva.getByFecha(fecha);
    res.json({ data: reservas });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const r = await CanchaReserva.getById(req.params.id);
    if (!r) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json(r);
  } catch (e) {
    sendError(res, e, 500);
  }
};

// Construye el payload de conflicto que el frontend usa para mostrar el
// mensaje "Choca con X (HH:MM-HH:MM)" de forma uniforme.
function conflictoPayload(conflicto) {
  const cliente =
    conflicto.ClienteNombre || conflicto.ClienteApellido
      ? `${conflicto.ClienteNombre || ""} ${conflicto.ClienteApellido || ""}`.trim()
      : conflicto.CanchaReservaCliente || "Otra reserva";
  const fmtH = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return {
    success: false,
    code: "CONFLICTO_HORARIO",
    message: `Se solapa con la reserva de ${cliente} (${fmtH(conflicto.CanchaReservaHoraInicio)} — ${fmtH(conflicto.CanchaReservaHoraFin)}).`,
    conflicto: {
      CanchaReservaId: conflicto.CanchaReservaId,
      cliente,
      horaInicio: conflicto.CanchaReservaHoraInicio,
      horaFin: conflicto.CanchaReservaHoraFin,
    },
  };
}

exports.create = async (req, res) => {
  try {
    const required = [
      "CanchaId",
      "CanchaReservaFecha",
      "CanchaReservaHoraInicio",
      "CanchaReservaHoraFin",
    ];
    for (const f of required) {
      if (req.body[f] === undefined || req.body[f] === null || req.body[f] === "")
        return res
          .status(400)
          .json({ success: false, message: `${f} es requerido` });
    }
    // Sanidad: hora_fin > hora_inicio. Sin esto, la query de conflicto da
    // resultados raros y podríamos crear reservas con duración negativa.
    if (req.body.CanchaReservaHoraFin <= req.body.CanchaReservaHoraInicio) {
      return res.status(400).json({
        success: false,
        message: "La hora de fin debe ser posterior a la hora de inicio.",
      });
    }
    // Bloqueamos crear si se solapa con otra reserva no cancelada.
    const conflicto = await CanchaReserva.verificarConflicto(req.body);
    if (conflicto) {
      return res.status(409).json(conflictoPayload(conflicto));
    }
    const reserva = await CanchaReserva.create({
      ...req.body,
      UsuarioId: req.body.UsuarioId || req.user?.UsuarioId || null,
    });
    res.status(201).json({ success: true, data: reserva });
  } catch (e) {
    console.error("Error al crear reserva cancha:", e);
    sendError(res, e, 500);
  }
};

exports.update = async (req, res) => {
  try {
    // Validar conflicto solo si en este update vienen los campos de horario.
    // Si el usuario solo cambia el monto o estado, no hay nada que chequear.
    const tieneHorario =
      req.body.CanchaReservaFecha !== undefined &&
      req.body.CanchaReservaHoraInicio !== undefined &&
      req.body.CanchaReservaHoraFin !== undefined &&
      req.body.CanchaId !== undefined;
    if (tieneHorario) {
      if (
        req.body.CanchaReservaHoraFin <= req.body.CanchaReservaHoraInicio
      ) {
        return res.status(400).json({
          success: false,
          message: "La hora de fin debe ser posterior a la hora de inicio.",
        });
      }
      // Solo validamos overlap si la reserva no se está marcando como cancelada.
      if (req.body.CanchaReservaEstado !== "X") {
        const conflicto = await CanchaReserva.verificarConflicto(
          req.body,
          req.params.id
        );
        if (conflicto) {
          return res.status(409).json(conflictoPayload(conflicto));
        }
      }
    }
    const r = await CanchaReserva.update(req.params.id, req.body);
    if (!r) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json({ success: true, data: r });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.remove = async (req, res) => {
  try {
    const ok = await CanchaReserva.delete(req.params.id);
    if (!ok) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json({ success: true });
  } catch (e) {
    sendError(res, e, 500);
  }
};
