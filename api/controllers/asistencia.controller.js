const Asistencia = require("../models/asistencia.model");

exports.estadoAcceso = async (req, res) => {
  try {
    const estado = await Asistencia.estadoAcceso(req.params.clienteId);
    // Adjuntamos info de "ya entró hoy" para que la UI lo muestre, pero no
    // bloqueamos el acceso por eso — re-entradas son válidas.
    if (estado.cliente?.ClienteId) {
      const existente = await Asistencia.asistenciaDelClienteHoy(
        estado.cliente.ClienteId
      );
      estado.asistenciaHoy = existente;
    }
    res.json(estado);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.registrar = async (req, res) => {
  try {
    const { ClienteId } = req.body;
    if (!ClienteId) {
      return res.status(400).json({ message: "ClienteId requerido" });
    }
    // Re-validar acceso del lado servidor (no confiar en el front).
    const estado = await Asistencia.estadoAcceso(ClienteId);
    if (!estado.permitido) {
      return res.status(403).json({ message: estado.motivo, estado });
    }
    const result = await Asistencia.registrar(ClienteId, estado.suscripcion);
    // Reflejar el cupo real post-descuento (no asumir -1).
    if (result.clasesRestantes != null && estado.suscripcion) {
      estado.suscripcion.SuscripcionClasesRestantes = result.clasesRestantes;
    }
    res.status(201).json({
      message: "Asistencia registrada",
      data: result.asistencia,
      estado,
    });
  } catch (error) {
    // Cupo agotado entre la validación y el registro (carrera).
    if (error.code === "SIN_CUPO") {
      return res.status(409).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.listar = async (req, res) => {
  try {
    const fecha = req.query.fecha;
    const data = await Asistencia.listarPorFecha(fecha);
    res.json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Endpoint del kiosko de auto-registro: el cliente tipea su CI (ClienteRUC),
// resolvemos al ClienteId, validamos estadoAcceso y, si esta permitido,
// registramos asistencia en la misma llamada. Es la operacion completa en
// una sola request para minimizar latencia en la tablet de entrada.
exports.kiosko = async (req, res) => {
  try {
    const ci = String(req.body?.ci || "").trim();
    if (!ci) {
      return res.status(400).json({
        permitido: false,
        motivo: "Cédula vacía",
        cliente: null,
        suscripcion: null,
      });
    }
    const row = await Asistencia.buscarPorRUC(ci);
    if (!row) {
      return res.json({
        permitido: false,
        motivo: "Cédula no encontrada",
        cliente: null,
        suscripcion: null,
      });
    }
    const estado = await Asistencia.estadoAcceso(row.ClienteId);
    if (!estado.permitido) {
      return res.json(estado);
    }
    const result = await Asistencia.registrar(row.ClienteId, estado.suscripcion);
    // El cupo se descontó dentro de `registrar`; reflejamos el valor REAL
    // devuelto por la transacción (no asumimos -1).
    if (result.clasesRestantes != null && estado.suscripcion) {
      estado.suscripcion.SuscripcionClasesRestantes = result.clasesRestantes;
    }
    return res.json({ ...estado, asistencia: result.asistencia });
  } catch (error) {
    if (error.code === "SIN_CUPO") {
      return res.json({
        permitido: false,
        motivo: "Cupo de clases agotado",
        cliente: null,
        suscripcion: null,
      });
    }
    console.error("Error en kiosko asistencia:", error);
    res.status(500).json({
      permitido: false,
      motivo: "Error interno",
      error: error.message,
    });
  }
};

exports.porCliente = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const data = await Asistencia.porCliente(req.params.clienteId, limit);
    res.json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.ranking = async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    if (!fechaDesde || !fechaHasta) {
      return res
        .status(400)
        .json({ message: "fechaDesde y fechaHasta son requeridos" });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const data = await Asistencia.ranking(fechaDesde, fechaHasta, limit);
    res.json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
