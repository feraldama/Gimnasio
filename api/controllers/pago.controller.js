const Pago = require("../models/pago.model");
const db = require("../config/db");
const { todayLocalISO, addDaysLocal } = require("../utils/dateUtils");
const { getTipoGastoGrupoId, getLabel } = require("../constants/pagoTipos");
const { calcularEstadoPorFechas } = require("../utils/suscripcionEstado");

exports.getAll = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  const sortBy = req.query.sortBy || "PagoId";
  const sortOrder = req.query.sortOrder || "ASC";
  try {
    const result = await Pago.getAllPaginated(limit, offset, sortBy, sortOrder);
    res.json({
      data: result.pagos,
      pagination: {
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const pago = await Pago.getById(req.params.id);
    if (!pago) {
      return res.status(404).json({ message: "Pago no encontrado" });
    }
    res.json(pago);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Crea N pagos atómicamente (multi-método: CO + PO + TR sobre la misma suscripción).
// Resuelve el rollback parcial cuando el frontend hacía un loop de N llamadas
// a POST /pagos: si el segundo fallaba, el primero quedaba creado.
//
// Body esperado:
//   {
//     pagos: [ { PagoMonto, PagoTipo, PagoFecha? }, ... ],
//     // Para vincular a una suscripción existente:
//     SuscripcionId?: number,
//     // O para crear la suscripción en el mismo lote:
//     ClienteId?, PlanId?, SuscripcionFechaInicio?, SuscripcionFechaFin?
//   }
exports.createLote = async (req, res) => {
  if (!Array.isArray(req.body.pagos) || req.body.pagos.length === 0) {
    return res
      .status(400)
      .json({ message: "Se requiere al menos un pago en el lote" });
  }
  if (!req.user?.id) {
    return res.status(401).json({ message: "Usuario no autenticado" });
  }
  const usuarioId = req.user.id;
  const pagos = req.body.pagos;

  // Validación previa (sin tocar BD): todos los pagos deben tener monto > 0 y tipo
  for (const p of pagos) {
    if (!p.PagoMonto || Number(p.PagoMonto) <= 0) {
      return res
        .status(400)
        .json({ message: "Todos los pagos deben tener un monto mayor a cero" });
    }
    if (!p.PagoTipo) {
      return res
        .status(400)
        .json({ message: "Todos los pagos deben tener un tipo" });
    }
  }

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    let suscripcionId = req.body.SuscripcionId;
    const crearSuscripcion =
      !suscripcionId && req.body.ClienteId && req.body.PlanId;

    if (crearSuscripcion) {
      const [planRows] = await connection.query(
        "SELECT PlanDuracion FROM plan WHERE PlanId = ?",
        [req.body.PlanId]
      );
      if (planRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Plan no encontrado" });
      }
      const plan = planRows[0];

      let fechaInicio;
      let fechaFin;
      if (req.body.SuscripcionFechaInicio && req.body.SuscripcionFechaFin) {
        fechaInicio = req.body.SuscripcionFechaInicio;
        fechaFin = req.body.SuscripcionFechaFin;
      } else {
        fechaInicio = todayLocalISO();
        fechaFin = addDaysLocal(fechaInicio, plan.PlanDuracion || 30);
      }

      const [suscResult] = await connection.query(
        "INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin, SuscripcionEstado) VALUES (?, ?, ?, ?, ?)",
        [
          req.body.ClienteId,
          req.body.PlanId,
          fechaInicio,
          fechaFin,
          calcularEstadoPorFechas(fechaInicio, fechaFin),
        ]
      );
      suscripcionId = suscResult.insertId;
    }

    if (!suscripcionId) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Se requiere SuscripcionId o ClienteId y PlanId para crear el lote",
      });
    }

    const pagosCreados = [];
    let totalMonto = 0;
    for (const p of pagos) {
      const pagoFecha = p.PagoFecha || new Date();
      const [r] = await connection.query(
        "INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId) VALUES (?, ?, ?, ?, ?)",
        [suscripcionId, p.PagoMonto, p.PagoTipo, pagoFecha, usuarioId]
      );
      pagosCreados.push({
        PagoId: r.insertId,
        SuscripcionId: suscripcionId,
        PagoMonto: p.PagoMonto,
        PagoTipo: p.PagoTipo,
        PagoFecha: pagoFecha,
        PagoUsuarioId: usuarioId,
      });
      totalMonto += Number(p.PagoMonto);
    }

    // Estado de caja del usuario (una sola vez para todo el lote)
    const [aperturas] = await connection.query(
      `SELECT RegistroDiarioCajaId, CajaId FROM registrodiariocaja
       WHERE UsuarioId = ? AND TipoGastoId = 2 AND TipoGastoGrupoId = 2
       ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
      [usuarioId]
    );
    const apertura = aperturas[0];
    let cajaAbierta = false;
    if (apertura?.CajaId) {
      const [cierres] = await connection.query(
        `SELECT RegistroDiarioCajaId FROM registrodiariocaja
         WHERE UsuarioId = ? AND TipoGastoId = 1 AND TipoGastoGrupoId = 2
         ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
        [usuarioId]
      );
      const cierreId = cierres[0]?.RegistroDiarioCajaId || 0;
      cajaAbierta = apertura.RegistroDiarioCajaId > cierreId;
    }

    if (cajaAbierta) {
      // Un movimiento por método (para que el detalle quede legible en el reporte de caja)
      for (const p of pagos) {
        const tipoGastoGrupoId = getTipoGastoGrupoId(p.PagoTipo);
        const detalle = `Pago suscripción #${suscripcionId} - ${getLabel(p.PagoTipo)}`;
        await connection.query(
          `INSERT INTO registrodiariocaja
           (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            apertura.CajaId,
            p.PagoFecha || new Date(),
            2,
            tipoGastoGrupoId,
            detalle,
            p.PagoMonto,
            usuarioId,
          ]
        );
      }
      // UPDATE atómico con la suma total: una sola contención sobre la fila de caja
      await connection.query(
        "UPDATE Caja SET CajaMonto = CajaMonto + ? WHERE CajaId = ?",
        [totalMonto, apertura.CajaId]
      );
    }

    await connection.commit();

    res.status(201).json({
      message:
        pagosCreados.length > 1
          ? `${pagosCreados.length} pagos creados exitosamente`
          : "Pago creado exitosamente",
      data: pagosCreados,
      suscripcionId,
      suscripcionCreada: crearSuscripcion,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      console.error("Error en rollback:", rollbackErr);
    }
    console.error("Error en createLote:", error);
    res.status(400).json({ message: error.message });
  } finally {
    connection.release();
  }
};

exports.create = async (req, res) => {
  // Transacción atómica: si falla cualquier paso (creación de suscripción,
  // pago, registro de caja o actualización del monto), se revierte todo.
  // El UPDATE de caja usa `CajaMonto = CajaMonto + ?` para evitar la
  // race condition de leer-sumar-escribir cuando hay pagos concurrentes.
  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    let suscripcionId = req.body.SuscripcionId;
    const crearSuscripcion =
      !suscripcionId && req.body.ClienteId && req.body.PlanId;

    if (crearSuscripcion) {
      const [planRows] = await connection.query(
        "SELECT PlanDuracion FROM plan WHERE PlanId = ?",
        [req.body.PlanId]
      );
      if (planRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Plan no encontrado" });
      }
      const plan = planRows[0];

      let fechaInicio;
      let fechaFin;
      if (req.body.SuscripcionFechaInicio && req.body.SuscripcionFechaFin) {
        fechaInicio = req.body.SuscripcionFechaInicio;
        fechaFin = req.body.SuscripcionFechaFin;
      } else {
        fechaInicio = todayLocalISO();
        fechaFin = addDaysLocal(fechaInicio, plan.PlanDuracion || 30);
      }

      const [suscResult] = await connection.query(
        "INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin, SuscripcionEstado) VALUES (?, ?, ?, ?, ?)",
        [
          req.body.ClienteId,
          req.body.PlanId,
          fechaInicio,
          fechaFin,
          calcularEstadoPorFechas(fechaInicio, fechaFin),
        ]
      );
      suscripcionId = suscResult.insertId;
    }

    if (!suscripcionId) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Se requiere SuscripcionId o ClienteId y PlanId para crear el pago",
      });
    }

    if (!req.user?.id) {
      await connection.rollback();
      return res.status(401).json({ message: "Usuario no autenticado" });
    }
    const pagoUsuarioId = req.user.id;
    const pagoFecha = req.body.PagoFecha || new Date();
    const pagoMonto = req.body.PagoMonto;
    const pagoTipo = req.body.PagoTipo;

    const [pagoResult] = await connection.query(
      "INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId) VALUES (?, ?, ?, ?, ?)",
      [suscripcionId, pagoMonto, pagoTipo, pagoFecha, pagoUsuarioId]
    );
    const pagoId = pagoResult.insertId;

    // Estado de apertura del usuario (inline para mantener todo en la transacción)
    const [aperturas] = await connection.query(
      `SELECT RegistroDiarioCajaId, CajaId FROM registrodiariocaja
       WHERE UsuarioId = ? AND TipoGastoId = 2 AND TipoGastoGrupoId = 2
       ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
      [pagoUsuarioId]
    );
    const apertura = aperturas[0];
    let cajaAbierta = false;
    if (apertura?.CajaId) {
      const [cierres] = await connection.query(
        `SELECT RegistroDiarioCajaId FROM registrodiariocaja
         WHERE UsuarioId = ? AND TipoGastoId = 1 AND TipoGastoGrupoId = 2
         ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
        [pagoUsuarioId]
      );
      const cierreId = cierres[0]?.RegistroDiarioCajaId || 0;
      cajaAbierta = apertura.RegistroDiarioCajaId > cierreId;
    }

    if (cajaAbierta) {
      const tipoGastoGrupoId = getTipoGastoGrupoId(pagoTipo);
      const detalle = `Pago suscripción #${suscripcionId} - ${getLabel(pagoTipo)}`;

      await connection.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          apertura.CajaId,
          pagoFecha,
          2,
          tipoGastoGrupoId,
          detalle,
          pagoMonto,
          pagoUsuarioId,
        ]
      );

      // UPDATE atómico: evita race condition entre pagos concurrentes
      await connection.query(
        "UPDATE Caja SET CajaMonto = CajaMonto + ? WHERE CajaId = ?",
        [pagoMonto, apertura.CajaId]
      );
    }

    await connection.commit();

    // Recuperar el pago completo (con JOIN a cliente) para devolverlo al cliente.
    // Se hace fuera de la transacción porque ya fue confirmada.
    const pago = await Pago.getById(pagoId);

    res.status(201).json({
      message: "Pago creado exitosamente",
      data: pago,
      suscripcionCreada: crearSuscripcion,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      console.error("Error en rollback:", rollbackErr);
    }
    console.error("Error al crear pago:", error);
    res.status(400).json({ message: error.message });
  } finally {
    connection.release();
  }
};

exports.update = async (req, res) => {
  try {
    // Preservar el PagoUsuarioId original: representa quién cobró,
    // no quién edita. No se debe sobrescribir desde el body.
    const pagoExistente = await Pago.getById(req.params.id);
    if (!pagoExistente) {
      return res.status(404).json({ message: "Pago no encontrado" });
    }
    const pagoData = {
      ...req.body,
      PagoUsuarioId: pagoExistente.PagoUsuarioId,
    };
    const pago = await Pago.update(req.params.id, pagoData);
    if (!pago) {
      return res.status(404).json({ message: "Pago no encontrado" });
    }
    res.json({ message: "Pago actualizado exitosamente", data: pago });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.delete = async (req, res) => {
  // Anulación transaccional: registra un movimiento de egreso en
  // registrodiariocaja que neutraliza el ingreso original y descuenta
  // el monto de Caja antes de borrar el pago. Requiere caja abierta
  // del usuario que anula (ajuste contable sobre caja actual).
  if (!req.user?.id) {
    return res.status(401).json({ message: "Usuario no autenticado" });
  }
  const usuarioId = req.user.id;

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [pagoRows] = await connection.query(
      "SELECT * FROM pago WHERE PagoId = ?",
      [req.params.id]
    );
    if (pagoRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Pago no encontrado" });
    }
    const pago = pagoRows[0];

    const [aperturas] = await connection.query(
      `SELECT RegistroDiarioCajaId, CajaId FROM registrodiariocaja
       WHERE UsuarioId = ? AND TipoGastoId = 2 AND TipoGastoGrupoId = 2
       ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
      [usuarioId]
    );
    const apertura = aperturas[0];
    let cajaAbierta = false;
    if (apertura?.CajaId) {
      const [cierres] = await connection.query(
        `SELECT RegistroDiarioCajaId FROM registrodiariocaja
         WHERE UsuarioId = ? AND TipoGastoId = 1 AND TipoGastoGrupoId = 2
         ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
        [usuarioId]
      );
      const cierreId = cierres[0]?.RegistroDiarioCajaId || 0;
      cajaAbierta = apertura.RegistroDiarioCajaId > cierreId;
    }

    if (!cajaAbierta) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Debe tener una caja aperturada para anular un pago (se registra el ajuste contable).",
      });
    }

    const tipoGastoGrupoId = getTipoGastoGrupoId(pago.PagoTipo);
    const detalle = `Anulación pago #${pago.PagoId} suscripción #${pago.SuscripcionId} - ${getLabel(pago.PagoTipo)}`;

    // TipoGastoId 1 = egreso: contrapartida del ingreso original
    await connection.query(
      `INSERT INTO registrodiariocaja
       (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
       VALUES (?, NOW(), ?, ?, ?, ?, ?)`,
      [apertura.CajaId, 1, tipoGastoGrupoId, detalle, pago.PagoMonto, usuarioId]
    );

    await connection.query(
      "UPDATE Caja SET CajaMonto = CajaMonto - ? WHERE CajaId = ?",
      [pago.PagoMonto, apertura.CajaId]
    );

    await connection.query("DELETE FROM pago WHERE PagoId = ?", [
      req.params.id,
    ]);

    await connection.commit();
    res.json({ message: "Pago anulado y caja ajustada exitosamente" });
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      console.error("Error en rollback:", rollbackErr);
    }
    if (error?.message?.includes("a foreign key constraint fails")) {
      return res.status(400).json({
        message:
          "No se puede eliminar el pago porque tiene registros asociados.",
      });
    }
    console.error("Error al anular pago:", error);
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

exports.getByClienteId = async (req, res) => {
  try {
    const pagos = await Pago.getByClienteId(req.params.clienteId);
    res.json({ data: pagos });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getReporte = async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    if (!fechaDesde || !fechaHasta) {
      return res
        .status(400)
        .json({ message: "Se requieren fechaDesde y fechaHasta" });
    }
    const agruparPor = ["dia", "semana", "mes"].includes(req.query.agruparPor)
      ? req.query.agruparPor
      : "dia";
    const reporte = await Pago.getReporte(fechaDesde, fechaHasta, agruparPor);
    res.json({ data: reporte, agruparPor, fechaDesde, fechaHasta });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.searchPagos = async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "PagoId";
    const sortOrder = req.query.sortOrder || "ASC";

    if (!searchTerm || searchTerm.trim() === "") {
      return res
        .status(400)
        .json({ error: "El término de búsqueda no puede estar vacío" });
    }

    const result = await Pago.searchPagos(
      searchTerm,
      limit,
      offset,
      sortBy,
      sortOrder
    );

    res.json({
      data: result.pagos,
      pagination: {
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Error al buscar pagos" });
  }
};
