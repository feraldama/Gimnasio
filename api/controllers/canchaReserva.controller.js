const CanchaReserva = require("../models/canchaReserva.model");
const db = require("../config/db");
const { sendError } = require("../utils/errors");
const { PAGO_TIPOS, getLabel } = require("../constants/pagoTipos");

// Métodos que efectivamente ingresan plata al cajón físico — sólo estos
// suman a Caja.CajaMonto. POS, voucher, transferencia, crédito: se registran
// en la planilla pero el saldo de caja queda igual (replica venta.controller).
const METODOS_EFECTIVO = new Set(["CO"]);

// Todos los cobros de cancha se categorizan bajo este grupo, independientemente
// del método de pago. El método queda escrito en el detalle para que los
// reportes lo filtren por LIKE. Permite la pregunta "¿cuánto cobré por cancha?"
// con un solo filtro estructural (TipoGastoGrupoId=7), y luego desglosar por
// método con LIKE 'Contado%', LIKE 'Transferencia%', etc.
const TIPO_GASTO_GRUPO_COBRO_CANCHA = 7;

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

// Cobra una reserva: la pasa a estado 'P' y registra cada método de pago en
// `registrodiariocaja`. Sólo CO suma al saldo de Caja; PO/VO/TR/CR quedan
// registrados pero no mueven el cajón físico (mismo criterio que venta.controller).
// Todo en una transacción: si algo falla, rollback completo.
exports.cobrar = async (req, res) => {
  const reservaId = req.params.id;
  const { pagos, fecha } = req.body || {};

  if (!Array.isArray(pagos) || pagos.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Debe enviar al menos un método de pago en `pagos`.",
    });
  }
  // Validar códigos y montos antes de abrir transacción.
  for (const p of pagos) {
    if (!p || !PAGO_TIPOS[p.tipo]) {
      return res.status(400).json({
        success: false,
        message: `Tipo de pago inválido: ${p?.tipo}`,
      });
    }
    const monto = Number(p.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({
        success: false,
        message: `Monto inválido para ${p.tipo}: ${p?.monto}`,
      });
    }
  }
  if (!req.user?.id) {
    return res.status(401).json({ success: false, message: "Usuario no autenticado" });
  }
  const usuarioId = req.user.id;
  const totalPagado = pagos.reduce((s, p) => s + Math.round(Number(p.monto)), 0);

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Lock + leer estado actual para evitar doble cobro en concurrencia.
    // JOIN con clientes para que el detalle del movimiento pueda incluir el
    // nombre — sin el JOIN, ClienteNombre/Apellido venían undefined y la
    // descripción quedaba como "Contado  #294" con doble espacio.
    const [reservas] = await connection.query(
      `SELECT r.*, c.ClienteNombre, c.ClienteApellido
       FROM cancha_reserva r
       LEFT JOIN clientes c ON c.ClienteId = r.ClienteId
       WHERE r.CanchaReservaId = ?`,
      [reservaId]
    );
    if (reservas.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Reserva no encontrada" });
    }
    const reserva = reservas[0];
    if (reserva.CanchaReservaEstado === "P") {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "YA_COBRADA",
        message: "Esta reserva ya está marcada como Pagada.",
      });
    }
    if (reserva.CanchaReservaEstado === "X") {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "CANCELADA",
        message: "No se puede cobrar una reserva cancelada.",
      });
    }

    // Crédito requiere un cliente registrado en BD: la deuda se persigue por
    // ClienteId en /credito-pagos. Si la reserva es de un invitado/externo
    // (sólo nombre libre, sin vínculo) rechazamos cualquier monto en CR.
    if (!reserva.ClienteId && pagos.some((p) => p.tipo === "CR")) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        code: "CR_SIN_CLIENTE",
        message:
          "No se puede cobrar a crédito una reserva de invitado/externo. Vinculá un cliente registrado antes de cobrar.",
      });
    }

    // Buscar caja abierta del usuario (último apertura sin cierre posterior).
    const [aperturas] = await connection.query(
      `SELECT RegistroDiarioCajaId, CajaId FROM registrodiariocaja
       WHERE UsuarioId = ? AND TipoGastoId = 2 AND TipoGastoGrupoId = 2
       ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
      [usuarioId]
    );
    const apertura = aperturas[0];
    if (!apertura?.CajaId) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "SIN_CAJA",
        message: "Para cobrar necesitás tener una caja abierta.",
      });
    }
    const [cierres] = await connection.query(
      `SELECT RegistroDiarioCajaId FROM registrodiariocaja
       WHERE UsuarioId = ? AND TipoGastoId = 1 AND TipoGastoGrupoId = 2
       ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
      [usuarioId]
    );
    const cierreId = cierres[0]?.RegistroDiarioCajaId || 0;
    if (apertura.RegistroDiarioCajaId <= cierreId) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "SIN_CAJA",
        message: "Tu última caja ya fue cerrada. Abrí una nueva antes de cobrar.",
      });
    }
    const cajaId = apertura.CajaId;
    const fechaMov = fecha || new Date();

    // Pasar reserva a Pagada + guardar el monto cobrado (puede diferir del
    // monto sugerido por descuentos o vueltos).
    await connection.query(
      `UPDATE cancha_reserva
       SET CanchaReservaEstado = 'P', CanchaReservaMonto = ?
       WHERE CanchaReservaId = ?`,
      [totalPagado, reservaId]
    );

    // Identificación legible de la reserva en el detalle del movimiento.
    // La columna `registrodiariocajadetalle` es VARCHAR(50), así que el detalle
    // debe entrar en 50 chars o el INSERT revienta con 22001. El método va al
    // principio para que el reporte filtre por LIKE 'Contado%' / 'POS%' /
    // 'Voucher%' / 'Transferencia%' / 'Crédito%'.
    const clienteRaw =
      [reserva.ClienteNombre, reserva.ClienteApellido].filter(Boolean).join(" ").trim() ||
      reserva.CanchaReservaCliente ||
      "";
    const truncar = (s, n) => (s && s.length > n ? s.slice(0, n) : s || "");

    let efectivoTotal = 0;
    let montoCredito = 0;
    for (const p of pagos) {
      const monto = Math.round(Number(p.monto));
      const tipo = p.tipo;
      const metodo = getLabel(tipo); // "Contado" | "POS" | "Voucher" | "Transferencia" | "Crédito"
      // Formato: "<Método> <CLIENTE> #<id>" — cliente se trunca para que el
      // total no exceda 50 chars.
      const sufijo = ` #${reservaId}`;
      const presupuesto = 50 - metodo.length - 1 - sufijo.length; // " " entre método y cliente
      const cliente = truncar(clienteRaw, Math.max(0, presupuesto));
      const detalle = truncar(`${metodo} ${cliente}${sufijo}`, 50);
      await connection.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
          RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, 2, ?, ?, ?, ?)`,
        [cajaId, fechaMov, TIPO_GASTO_GRUPO_COBRO_CANCHA, detalle, monto, usuarioId]
      );
      if (METODOS_EFECTIVO.has(tipo)) efectivoTotal += monto;
      if (tipo === "CR") montoCredito += monto;
    }

    // Si una parte del cobro fue a crédito, registramos la deuda en
    // `cancha_credito`. La validación previa ya garantiza que hay ClienteId
    // (no se permite CR sin cliente vinculado). El saldo inicial = monto
    // original, y se decrementará a medida que se cobre con /credito-pagos.
    if (montoCredito > 0) {
      await connection.query(
        `INSERT INTO cancha_credito
         (CanchaReservaId, ClienteId, CanchaCreditoMonto, CanchaCreditoSaldo,
          CanchaCreditoFecha, CanchaCreditoPagoCant, UsuarioId)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [reservaId, reserva.ClienteId, montoCredito, montoCredito, fechaMov, usuarioId]
      );
    }

    if (efectivoTotal > 0) {
      await connection.query(
        "UPDATE Caja SET CajaMonto = CajaMonto + ? WHERE CajaId = ?",
        [efectivoTotal, cajaId]
      );
    }

    await connection.commit();
    const r = await CanchaReserva.getById(reservaId);
    res.json({
      success: true,
      data: r,
      cobro: {
        totalPagado,
        efectivoSumadoACaja: efectivoTotal,
        cajaId,
      },
    });
  } catch (e) {
    try {
      await connection.rollback();
    } catch (_) {
      /* rollback puede fallar si la conexión ya está rota; lo ignoramos */
    }
    console.error("Error al cobrar reserva:", e);
    sendError(res, e, 500);
  } finally {
    connection.release();
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
