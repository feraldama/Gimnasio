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
    const asistencia = await Asistencia.registrar(ClienteId);
    res.status(201).json({
      message: "Asistencia registrada",
      data: asistencia,
      estado,
    });
  } catch (error) {
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
