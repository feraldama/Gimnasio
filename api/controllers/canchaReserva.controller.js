const CanchaReserva = require("../models/canchaReserva.model");
const db = require("../config/db");
const { sendError } = require("../utils/errors");
const { addDaysLocal } = require("../utils/dateUtils");
const {
  PAGO_TIPOS,
  METODOS_EFECTIVO,
  getLabel,
} = require("../constants/pagoTipos");

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

// Verificación de conflicto que corre DENTRO de una transacción ya abierta.
// Idéntica a CanchaReserva.verificarConflicto pero usando la connection de la
// tx — clave para que el advisory lock proteja el check y el INSERT/UPDATE
// como una unidad atómica.
async function verificarConflictoTx(connection, data, excludeId = null) {
  const params = [
    data.CanchaId,
    data.CanchaReservaFecha,
    data.CanchaReservaHoraFin,
    data.CanchaReservaHoraInicio,
  ];
  let sql = `
    SELECT r.CanchaReservaId, r.CanchaReservaHoraInicio, r.CanchaReservaHoraFin,
           r.CanchaReservaCliente, r.CanchaReservaEstado,
           cl.ClienteNombre, cl.ClienteApellido
    FROM cancha_reserva r
    LEFT JOIN clientes cl ON cl.ClienteId = r.ClienteId
    WHERE r.CanchaId = ?
      AND r.CanchaReservaFecha = ?
      AND r.CanchaReservaEstado <> 'X'
      AND r.CanchaReservaHoraInicio < ?
      AND r.CanchaReservaHoraFin > ?
  `;
  if (excludeId) {
    sql += " AND r.CanchaReservaId <> ?";
    params.push(excludeId);
  }
  sql += " ORDER BY r.CanchaReservaHoraInicio LIMIT 1";
  const [rows] = await connection.query(sql, params);
  return rows[0] || null;
}

// Extrae "HH:MM:SS" de un timestamp tipo "2026-05-21 15:00:00" o un TIME
// "15:00" / "15:00:00". Necesario porque `cancha_reserva.CanchaReservaHoraInicio`
// se guarda como TIMESTAMP en BD y el frontend manda timestamps completos,
// pero la tabla de bloqueos compara contra columnas TIME.
function extraerHora(ts) {
  if (!ts) return null;
  const m = String(ts).match(/(\d{2}:\d{2}(?::\d{2})?)/);
  return m ? (m[1].length === 5 ? `${m[1]}:00` : m[1]) : null;
}

// Verifica si la reserva cae sobre un bloqueo activo (mantenimiento, feriado,
// evento privado, etc.). Devuelve el primer bloqueo aplicable o null.
//
// Reglas de solape de horarios:
//   - bloqueo con horas NULL ⇒ todo el día
//   - solape de rango: bd < rh && bh > rd (mismas que reservas)
//   - canchaid NULL en el bloqueo significa "todas las canchas"
async function verificarBloqueoTx(connection, data) {
  const hIni = extraerHora(data.CanchaReservaHoraInicio);
  const hFin = extraerHora(data.CanchaReservaHoraFin);
  if (!hIni || !hFin) return null;
  const [rows] = await connection.query(
    `SELECT b.CanchaBloqueoId, b.CanchaBloqueoMotivo,
            b.CanchaBloqueoHoraDesde, b.CanchaBloqueoHoraHasta,
            b.CanchaId
     FROM cancha_bloqueo b
     WHERE b.CanchaBloqueoFecha = ?
       AND (b.CanchaId IS NULL OR b.CanchaId = ?)
       AND (
         b.CanchaBloqueoHoraDesde IS NULL OR b.CanchaBloqueoHoraHasta IS NULL
         OR (
           b.CanchaBloqueoHoraDesde < ?::time
           AND b.CanchaBloqueoHoraHasta > ?::time
         )
       )
     ORDER BY b.CanchaBloqueoId ASC LIMIT 1`,
    [data.CanchaReservaFecha, data.CanchaId, hFin, hIni]
  );
  return rows[0] || null;
}

function bloqueoPayload(bloqueo) {
  const todoElDia =
    !bloqueo.CanchaBloqueoHoraDesde || !bloqueo.CanchaBloqueoHoraHasta;
  const detalle = todoElDia
    ? "todo el día"
    : `${String(bloqueo.CanchaBloqueoHoraDesde).slice(0, 5)} — ${String(bloqueo.CanchaBloqueoHoraHasta).slice(0, 5)}`;
  const motivo = bloqueo.CanchaBloqueoMotivo || "Sin motivo";
  return {
    success: false,
    code: "BLOQUEO_HORARIO",
    message: `Cancha bloqueada (${detalle}): ${motivo}.`,
    bloqueo: {
      CanchaBloqueoId: bloqueo.CanchaBloqueoId,
      motivo,
      todoElDia,
      horaDesde: bloqueo.CanchaBloqueoHoraDesde,
      horaHasta: bloqueo.CanchaBloqueoHoraHasta,
    },
  };
}

// Toma un advisory lock transaccional por (módulo, canchaId). Serializa todas
// las operaciones de create/update sobre la misma cancha mientras esta tx
// esté abierta. Canchas distintas no se bloquean entre sí. El lock se libera
// automáticamente al COMMIT o ROLLBACK.
//
// El "namespace" 4242 es arbitrario; sirve para que el módulo cancha_reserva
// no choque con otros usos de advisory locks que pueda haber en la app.
async function lockCancha(connection, canchaId) {
  await connection.query("SELECT pg_advisory_xact_lock(?, ?)", [
    4242,
    Number(canchaId),
  ]);
}

exports.create = async (req, res) => {
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

  // Transacción: lock + check + insert atómicos. Dos POST simultáneos al
  // mismo slot se serializan acá; el segundo encuentra la reserva del primero
  // y devuelve 409, en vez de crear duplicado.
  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();
    await lockCancha(connection, req.body.CanchaId);

    // Verificar bloqueo PRIMERO (mantenimiento / feriado / evento privado).
    // Si el slot está bloqueado, no tiene sentido siquiera chequear contra
    // otras reservas porque no se puede reservar igual.
    const bloqueo = await verificarBloqueoTx(connection, req.body);
    if (bloqueo) {
      await connection.rollback();
      return res.status(409).json(bloqueoPayload(bloqueo));
    }
    const conflicto = await verificarConflictoTx(connection, req.body);
    if (conflicto) {
      await connection.rollback();
      return res.status(409).json(conflictoPayload(conflicto));
    }

    const usuarioId = req.body.UsuarioId || req.user?.UsuarioId || null;
    const [ins] = await connection.query(
      `INSERT INTO cancha_reserva
       (CanchaId, ClienteId, CanchaReservaCliente, CanchaReservaFecha,
        CanchaReservaHoraInicio, CanchaReservaHoraFin, CanchaReservaMonto,
        CanchaReservaEstado, CanchaReservaObservacion, UsuarioId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.body.CanchaId,
        req.body.ClienteId || null,
        req.body.CanchaReservaCliente || "",
        req.body.CanchaReservaFecha,
        req.body.CanchaReservaHoraInicio,
        req.body.CanchaReservaHoraFin,
        req.body.CanchaReservaMonto ?? 0,
        req.body.CanchaReservaEstado || "R",
        req.body.CanchaReservaObservacion || "",
        usuarioId,
      ]
    );
    await connection.commit();

    // Recuperar con JOINs (cancha + cliente) para devolver objeto completo
    // al frontend. Esto vive fuera de la transacción.
    const reserva = await CanchaReserva.getById(ins.insertId);
    res.status(201).json({ success: true, data: reserva });
  } catch (e) {
    try {
      await connection.rollback();
    } catch (_) {
      /* rollback puede fallar si la conexión ya está rota */
    }
    console.error("Error al crear reserva cancha:", e);
    sendError(res, e, 500);
  } finally {
    connection.release();
  }
};

exports.update = async (req, res) => {
  // Validar conflicto solo si en este update vienen los campos de horario.
  // Si el usuario solo cambia el monto o estado, no hay solapamiento posible
  // y nos ahorramos la transacción.
  const tieneHorario =
    req.body.CanchaReservaFecha !== undefined &&
    req.body.CanchaReservaHoraInicio !== undefined &&
    req.body.CanchaReservaHoraFin !== undefined &&
    req.body.CanchaId !== undefined;

  if (!tieneHorario) {
    try {
      const r = await CanchaReserva.update(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Reserva no encontrada" });
      return res.json({ success: true, data: r });
    } catch (e) {
      return sendError(res, e, 500);
    }
  }

  if (req.body.CanchaReservaHoraFin <= req.body.CanchaReservaHoraInicio) {
    return res.status(400).json({
      success: false,
      message: "La hora de fin debe ser posterior a la hora de inicio.",
    });
  }

  // Update con horario: misma estrategia que create — advisory lock + check +
  // update atómicos. Si la reserva se está cancelando (estado 'X'), nos
  // saltamos el check de overlap (no compite con nadie).
  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();
    await lockCancha(connection, req.body.CanchaId);

    if (req.body.CanchaReservaEstado !== "X") {
      // Mismo orden que create: bloqueo primero, después overlap de reservas.
      const bloqueo = await verificarBloqueoTx(connection, req.body);
      if (bloqueo) {
        await connection.rollback();
        return res.status(409).json(bloqueoPayload(bloqueo));
      }
      const conflicto = await verificarConflictoTx(
        connection,
        req.body,
        req.params.id
      );
      if (conflicto) {
        await connection.rollback();
        return res.status(409).json(conflictoPayload(conflicto));
      }
    }

    // El UPDATE corre adentro de la transacción para que el advisory lock
    // proteja también la escritura, no sólo el check. Replicamos el build
    // dinámico de columnas del modelo (no podemos llamar al modelo porque
    // usa una conexión nueva del pool, fuera del lock).
    const cols = [
      "CanchaId",
      "ClienteId",
      "CanchaReservaCliente",
      "CanchaReservaFecha",
      "CanchaReservaHoraInicio",
      "CanchaReservaHoraFin",
      "CanchaReservaMonto",
      "CanchaReservaEstado",
      "CanchaReservaObservacion",
    ];
    const fields = [];
    const values = [];
    cols.forEach((c) => {
      if (req.body[c] !== undefined) {
        fields.push(`${c} = ?`);
        values.push(req.body[c]);
      }
    });
    if (fields.length === 0) {
      await connection.rollback();
      return res.json({ success: true, data: null });
    }
    values.push(req.params.id);
    const [updRes] = await connection.query(
      `UPDATE cancha_reserva SET ${fields.join(", ")} WHERE CanchaReservaId = ?`,
      values
    );
    if (!updRes.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: "Reserva no encontrada" });
    }
    await connection.commit();
    const r = await CanchaReserva.getById(req.params.id);
    if (!r) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json({ success: true, data: r });
  } catch (e) {
    try {
      await connection.rollback();
    } catch (_) {
      /* rollback puede fallar si la conexión ya está rota */
    }
    console.error("Error al actualizar reserva cancha:", e);
    sendError(res, e, 500);
  } finally {
    connection.release();
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
    //
    // `FOR UPDATE OF r` lockea la fila de la reserva (no la del cliente) hasta
    // que esta transacción haga commit. Sin esto, dos POST /cobrar simultáneos
    // sobre la misma reserva R pasaban ambos el check `estado !== "P"` y
    // creaban duplicado de movimientos en caja + crédito.
    const [reservas] = await connection.query(
      `SELECT r.*, c.ClienteNombre, c.ClienteApellido
       FROM cancha_reserva r
       LEFT JOIN clientes c ON c.ClienteId = r.ClienteId
       WHERE r.CanchaReservaId = ?
       FOR UPDATE OF r`,
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

// Anula el cobro de una reserva ya Pagada: registra movimientos de
// contrapartida (egresos) en `registrodiariocaja` por cada movimiento de
// ingreso original, revierte el saldo de Caja para la porción de efectivo,
// borra el crédito asociado si existe, y vuelve la reserva a estado 'R'.
//
// Casos típicos: el cliente devuelve la plata por no haber ido a jugar, error
// del operador al cobrar a la reserva equivocada, etc.
//
// La búsqueda de movimientos a revertir matchea por:
//   - TipoGastoId = 2 (ingreso) + TipoGastoGrupoId = 7 (cobro cancha)
//   - detalle LIKE '%#<reservaId>$' (el id va al final del detalle)
// Anulaciones previas son egresos (TipoGastoId=1) y por eso no se incluyen
// en el set a revertir. Idempotente: si la reserva ya está en 'R', devuelve
// 409 (no hay nada que anular).
//
// PRIMER_TOKEN del detalle nos dice el método (Contado/POS/Voucher/...) lo
// cual sirve para decidir si se debe restar de CajaMonto (sólo CO) y para
// armar el detalle de la contrapartida.
exports.anularCobro = async (req, res) => {
  const reservaId = req.params.id;
  if (!req.user?.id) {
    return res.status(401).json({ success: false, message: "Usuario no autenticado" });
  }
  const usuarioId = req.user.id;

  const PRIMER_TOKEN_A_TIPO = {
    Contado: "CO",
    POS: "PO",
    Voucher: "VO",
    Transferencia: "TR",
    Crédito: "CR",
  };

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Lock reserva — evita doble anulación concurrente.
    const [reservas] = await connection.query(
      `SELECT r.*, c.ClienteNombre, c.ClienteApellido
       FROM cancha_reserva r
       LEFT JOIN clientes c ON c.ClienteId = r.ClienteId
       WHERE r.CanchaReservaId = ?
       FOR UPDATE OF r`,
      [reservaId]
    );
    if (reservas.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Reserva no encontrada" });
    }
    const reserva = reservas[0];
    if (reserva.CanchaReservaEstado !== "P") {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "NO_PAGADA",
        message: "Solo se pueden anular reservas en estado Pagada.",
      });
    }

    // Caja abierta (la contrapartida sale por la caja del operador).
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
        message: "Para anular necesitás tener una caja abierta.",
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
        message: "Tu última caja ya fue cerrada. Abrí una nueva antes de anular.",
      });
    }
    const cajaId = apertura.CajaId;
    const fechaMov = new Date();

    // Movimientos originales del cobro (ingresos de cobro cancha que matchean
    // el id de esta reserva al final del detalle).
    const [movs] = await connection.query(
      `SELECT RegistroDiarioCajaId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto
       FROM registrodiariocaja
       WHERE TipoGastoId = 2
         AND TipoGastoGrupoId = 7
         AND RegistroDiarioCajaDetalle ~ ?
       ORDER BY RegistroDiarioCajaId ASC`,
      [`#${reservaId}$`]
    );
    if (movs.length === 0) {
      // Caso raro: reserva en P pero sin movimientos en caja. Aún así,
      // permitimos anular para limpiar el estado.
      console.warn(
        `Reserva #${reservaId} estaba en P pero sin movimientos en registrodiariocaja.`
      );
    }

    // Para cada movimiento original, crear la contrapartida.
    const clienteRaw =
      [reserva.ClienteNombre, reserva.ClienteApellido]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      reserva.CanchaReservaCliente ||
      "";
    const truncar = (s, n) => (s && s.length > n ? s.slice(0, n) : s || "");
    let efectivoAreversar = 0;

    for (const m of movs) {
      const primerToken = String(m.RegistroDiarioCajaDetalle || "")
        .trim()
        .split(/\s+/)[0];
      const tipo = PRIMER_TOKEN_A_TIPO[primerToken] || "CO";
      const monto = Math.round(Number(m.RegistroDiarioCajaMonto) || 0);
      // Detalle de la contrapartida: prefijo "Anul." para distinguirlas
      // visualmente de los cobros originales en el reporte.
      const prefijo = `Anul. ${primerToken} `;
      const sufijo = ` #${reservaId}`;
      const presupuesto = 50 - prefijo.length - sufijo.length;
      const cli = truncar(clienteRaw, Math.max(0, presupuesto));
      const detalle = truncar(`${prefijo}${cli}${sufijo}`, 50);

      // TipoGastoId = 1 (egreso), mismo TipoGastoGrupoId = 7 para que sigan
      // categorizados como cobro cancha (los reportes los suman con signo).
      await connection.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
          RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, 1, 7, ?, ?, ?)`,
        [cajaId, fechaMov, detalle, monto, usuarioId]
      );
      if (METODOS_EFECTIVO.has(tipo)) efectivoAreversar += monto;
    }

    if (efectivoAreversar > 0) {
      await connection.query(
        "UPDATE Caja SET CajaMonto = CajaMonto - ? WHERE CajaId = ?",
        [efectivoAreversar, cajaId]
      );
    }

    // Borrar crédito asociado (si lo había). Si tiene pagos parciales ya
    // aplicados, esos pagos NO se revierten — la lógica de "anular cobro"
    // asume que el cliente devuelve la plata original; los pagos posteriores
    // del crédito son otra historia. Lo dejamos como mejora futura si surge
    // el caso.
    const [credRows] = await connection.query(
      `SELECT CanchaCreditoId, CanchaCreditoPagoCant
       FROM cancha_credito
       WHERE CanchaReservaId = ?`,
      [reservaId]
    );
    for (const c of credRows) {
      if (Number(c.CanchaCreditoPagoCant) > 0) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          code: "CREDITO_CON_PAGOS",
          message:
            "El crédito asociado a esta reserva ya recibió pagos parciales. Anular esos pagos primero, o usar un proceso de devolución manual.",
        });
      }
      await connection.query(
        "DELETE FROM cancha_credito WHERE CanchaCreditoId = ?",
        [c.CanchaCreditoId]
      );
    }

    // Reserva vuelve a 'R' (Reservada). El monto se preserva como referencia
    // (el operador suele querer ver cuánto se había cobrado para entender
    // qué pasó); si querés limpiarlo, lo seteás manualmente.
    await connection.query(
      "UPDATE cancha_reserva SET CanchaReservaEstado = 'R' WHERE CanchaReservaId = ?",
      [reservaId]
    );

    await connection.commit();
    const r = await CanchaReserva.getById(reservaId);
    res.json({
      success: true,
      data: r,
      anulacion: {
        movimientosRevertidos: movs.length,
        efectivoDescontadoDeCaja: efectivoAreversar,
        creditoBorrado: credRows.length > 0,
      },
    });
  } catch (e) {
    try {
      await connection.rollback();
    } catch (_) {
      /* ignorado */
    }
    console.error("Error al anular cobro reserva:", e);
    sendError(res, e, 500);
  } finally {
    connection.release();
  }
};

exports.remove = async (req, res) => {
  try {
    const reservaId = req.params.id;

    // Bloquear borrado si hay crédito asociado con saldo pendiente. Sin esto,
    // el crédito queda huérfano apuntando a una reserva inexistente y se
    // muestra para siempre en /credito-pagos con CanchaNombre = null.
    // Mismo patrón de defensa que usa cancha.controller cuando se intenta
    // eliminar una cancha que tiene reservas.
    const creditos = await new Promise((resolve, reject) => {
      db.query(
        `SELECT COUNT(*) AS n
         FROM cancha_credito
         WHERE CanchaReservaId = ? AND CanchaCreditoSaldo > 0`,
        [reservaId],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });
    const conDeuda = Number(creditos[0]?.n || 0);
    if (conDeuda > 0) {
      return res.status(409).json({
        success: false,
        code: "TIENE_CREDITO_PENDIENTE",
        message:
          "No se puede eliminar la reserva porque tiene un crédito con saldo pendiente. Cobrar o anular el crédito primero.",
        creditosPendientes: conDeuda,
      });
    }

    const ok = await CanchaReserva.delete(reservaId);
    if (!ok) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json({ success: true });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// Crea una serie de reservas recurrentes (ej. "todos los lunes 19hs por 8
// semanas"). Devuelve un detalle de cuáles se pudieron crear y cuáles
// fueron rechazadas por conflicto/bloqueo — el operador decide si quiere
// reintentar los rechazados a otra hora o con otra cancha.
//
// Body esperado:
//   {
//     CanchaId, ClienteId?, CanchaReservaCliente?,
//     fechaInicio: "YYYY-MM-DD",         // inicio de la serie (no se crean fechas previas)
//     diasSemana?: "L,M,X,J,V,S,D",      // días a generar (CSV de siglas, opcional)
//     cantidadSemanas: N,                // total de reservas a generar (incl. la primera)
//     CanchaReservaHoraInicio: "HH:MM",  // mismo horario en todas
//     CanchaReservaHoraFin: "HH:MM",
//     CanchaReservaMonto?, CanchaReservaObservacion?, CanchaReservaEstado?
//   }
//
// Estrategia: todas las reservas comparten un SerieId nuevo (el id de la
// primera reserva creada). El advisory lock se toma por cancha — todas las
// fechas de la serie pasan por el mismo lock. Cada fecha se valida individual
// (conflicto + bloqueo); las que pasan se insertan, las que fallan se reportan
// y la transacción sigue.
exports.crearRecurrente = async (req, res) => {
  const {
    CanchaId,
    ClienteId,
    CanchaReservaCliente,
    fechaInicio,
    diasSemana,
    cantidadSemanas,
    CanchaReservaHoraInicio,
    CanchaReservaHoraFin,
    CanchaReservaMonto,
    CanchaReservaObservacion,
    CanchaReservaEstado,
  } = req.body || {};

  // Validaciones básicas.
  if (!CanchaId || !fechaInicio || !CanchaReservaHoraInicio || !CanchaReservaHoraFin) {
    return res.status(400).json({
      success: false,
      message:
        "CanchaId, fechaInicio, CanchaReservaHoraInicio y CanchaReservaHoraFin son requeridos.",
    });
  }
  const cant = parseInt(cantidadSemanas, 10);
  if (!Number.isFinite(cant) || cant < 2 || cant > 52) {
    return res.status(400).json({
      success: false,
      message: "cantidadSemanas debe estar entre 2 y 52.",
    });
  }
  if (CanchaReservaHoraFin <= CanchaReservaHoraInicio) {
    return res.status(400).json({
      success: false,
      message: "La hora de fin debe ser posterior a la hora de inicio.",
    });
  }

  // Días de la semana a generar. Siglas L,M,X,J,V,S,D (mismo formato que las
  // bandas de tarifa). Si no se especifica, se usa el día de semana de
  // `fechaInicio` (comportamiento histórico: una reserva por semana).
  const OFFSET_LUN = { L: 0, M: 1, X: 2, J: 3, V: 4, S: 5, D: 6 };
  const ORDEN_DIAS = ["L", "M", "X", "J", "V", "S", "D"];
  const SIGLA_BY_JSDAY = ["D", "L", "M", "X", "J", "V", "S"]; // getDay 0=Dom..6=Sab

  const diasSeleccionados = String(diasSemana || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => OFFSET_LUN[s] !== undefined);
  if (diasSeleccionados.length === 0) {
    const [yi, mi, di] = String(fechaInicio).split("-").map(Number);
    diasSeleccionados.push(SIGLA_BY_JSDAY[new Date(yi, mi - 1, di).getDay()]);
  }

  // Calcular las fechas: para cada una de las N semanas, una fecha por cada
  // día seleccionado. Anclamos al lunes de la semana de `fechaInicio` y
  // descartamos las ocurrencias anteriores a `fechaInicio`. addDaysLocal
  // evita saltos de zona horaria (acepta offsets negativos).
  const [fy, fm, fd] = String(fechaInicio).split("-").map(Number);
  const jsDay = new Date(fy, fm - 1, fd).getDay();
  const lunesISO = addDaysLocal(fechaInicio, jsDay === 0 ? -6 : 1 - jsDay);
  const fechas = [];
  for (let w = 0; w < cant; w++) {
    for (const sigla of ORDEN_DIAS) {
      if (!diasSeleccionados.includes(sigla)) continue;
      const f = addDaysLocal(lunesISO, w * 7 + OFFSET_LUN[sigla]);
      if (f >= fechaInicio) fechas.push(f);
    }
  }

  const usuarioId = req.body.UsuarioId || req.user?.UsuarioId || req.user?.id || null;

  // Helper para concatenar fecha + hora del request en TIMESTAMP completo,
  // igual que hace el frontend antes de mandar create individual.
  const tsOf = (fecha, hora) => {
    const h = hora.length === 5 ? `${hora}:00` : hora;
    return `${fecha} ${h}`;
  };

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();
    await lockCancha(connection, CanchaId);

    const creadas = [];
    const rechazadas = [];
    let serieId = null;

    for (const fecha of fechas) {
      const data = {
        CanchaId,
        CanchaReservaFecha: fecha,
        CanchaReservaHoraInicio: tsOf(fecha, CanchaReservaHoraInicio),
        CanchaReservaHoraFin: tsOf(fecha, CanchaReservaHoraFin),
      };
      // Check bloqueo
      const bloqueo = await verificarBloqueoTx(connection, data);
      if (bloqueo) {
        rechazadas.push({
          fecha,
          razon: "BLOQUEO",
          mensaje: `Cancha bloqueada: ${bloqueo.CanchaBloqueoMotivo || "sin motivo"}`,
        });
        continue;
      }
      // Check overlap con otras reservas
      const conflicto = await verificarConflictoTx(connection, data);
      if (conflicto) {
        const cli =
          conflicto.ClienteNombre || conflicto.ClienteApellido
            ? `${conflicto.ClienteNombre || ""} ${conflicto.ClienteApellido || ""}`.trim()
            : conflicto.CanchaReservaCliente || "otra reserva";
        rechazadas.push({
          fecha,
          razon: "CONFLICTO",
          mensaje: `Choca con ${cli}`,
        });
        continue;
      }
      // Insert
      const [ins] = await connection.query(
        `INSERT INTO cancha_reserva
         (CanchaId, ClienteId, CanchaReservaCliente, CanchaReservaFecha,
          CanchaReservaHoraInicio, CanchaReservaHoraFin, CanchaReservaMonto,
          CanchaReservaEstado, CanchaReservaObservacion, UsuarioId,
          CanchaReservaSerieId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          CanchaId,
          ClienteId || null,
          CanchaReservaCliente || "",
          fecha,
          data.CanchaReservaHoraInicio,
          data.CanchaReservaHoraFin,
          CanchaReservaMonto ?? 0,
          CanchaReservaEstado || "R",
          CanchaReservaObservacion || "",
          usuarioId,
          serieId, // null para la primera, luego rellenamos
        ]
      );
      // La primera reserva define el SerieId (su propio id). Las siguientes
      // se actualizan al final. Insertamos null y arreglamos después porque
      // no podemos saber el id antes del INSERT.
      creadas.push({ id: ins.insertId, fecha });
      if (serieId === null) serieId = ins.insertId;
    }

    // Si al menos una se creó, propagar SerieId a todas las creadas.
    if (creadas.length > 0 && serieId !== null) {
      const ids = creadas.map((c) => c.id);
      // Usamos un placeholder por id porque el adapter PG traduce ? a $N.
      const placeholders = ids.map(() => "?").join(",");
      await connection.query(
        `UPDATE cancha_reserva SET CanchaReservaSerieId = ?
         WHERE CanchaReservaId IN (${placeholders})`,
        [serieId, ...ids]
      );
    }

    await connection.commit();
    res.status(201).json({
      success: true,
      serieId,
      creadas: creadas.length,
      rechazadas: rechazadas.length,
      detalle: { creadas, rechazadas },
    });
  } catch (e) {
    try {
      await connection.rollback();
    } catch (_) {
      /* ignorado */
    }
    console.error("Error al crear reserva recurrente:", e);
    sendError(res, e, 500);
  } finally {
    connection.release();
  }
};

// Lista todas las reservas que comparten un SerieId. Incluye el nombre de
// cancha y el cliente para que el frontend pueda mostrar un resumen sin
// hacer más queries.
exports.listarSerie = async (req, res) => {
  try {
    const serieId = parseInt(req.params.serieId, 10);
    if (!Number.isFinite(serieId)) {
      return res.status(400).json({ message: "serieId inválido" });
    }
    const sql = `
      SELECT r.*, ca.CanchaNombre, cl.ClienteNombre, cl.ClienteApellido
      FROM cancha_reserva r
      LEFT JOIN cancha ca ON ca.CanchaId = r.CanchaId
      LEFT JOIN clientes cl ON cl.ClienteId = r.ClienteId
      WHERE r.CanchaReservaSerieId = ?
      ORDER BY r.CanchaReservaFecha ASC, r.CanchaReservaHoraInicio ASC
    `;
    const rows = await new Promise((resolve, reject) => {
      db.query(sql, [serieId], (err, r) =>
        err ? reject(err) : resolve(r)
      );
    });
    res.json({ data: rows, serieId });
  } catch (e) {
    sendError(res, e, 500);
  }
};

// Cancela todas las reservas R (Reservadas) de una serie marcándolas como X.
// Las P (Pagadas) NO se tocan — anularlas requiere reverter movimientos en
// caja, lo que es otro flujo (anular-cobro). Devuelve cuántas se cancelaron
// y cuáles quedaron pagadas (para que el operador decida si las anula a mano).
exports.cancelarSerie = async (req, res) => {
  const serieId = parseInt(req.params.serieId, 10);
  if (!Number.isFinite(serieId)) {
    return res.status(400).json({ message: "serieId inválido" });
  }
  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Lock las reservas de la serie para evitar que se cobre una en paralelo
    // mientras la cancelamos.
    const [reservas] = await connection.query(
      `SELECT CanchaReservaId, CanchaReservaFecha, CanchaReservaEstado, CanchaId
       FROM cancha_reserva
       WHERE CanchaReservaSerieId = ?
       FOR UPDATE`,
      [serieId]
    );
    if (reservas.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Serie no encontrada o vacía" });
    }

    const aCancelar = reservas.filter((r) => r.CanchaReservaEstado === "R");
    const pagadas = reservas.filter((r) => r.CanchaReservaEstado === "P");
    const yaCanceladas = reservas.filter((r) => r.CanchaReservaEstado === "X");

    if (aCancelar.length > 0) {
      const ids = aCancelar.map((r) => r.CanchaReservaId);
      const placeholders = ids.map(() => "?").join(",");
      await connection.query(
        `UPDATE cancha_reserva
         SET CanchaReservaEstado = 'X'
         WHERE CanchaReservaId IN (${placeholders})`,
        ids
      );
    }

    await connection.commit();
    res.json({
      success: true,
      serieId,
      canceladas: aCancelar.length,
      yaCanceladas: yaCanceladas.length,
      conPagadas: pagadas.map((r) => ({
        id: r.CanchaReservaId,
        fecha: r.CanchaReservaFecha,
      })),
    });
  } catch (e) {
    try {
      await connection.rollback();
    } catch (_) {
      /* ignorado */
    }
    console.error("Error al cancelar serie:", e);
    sendError(res, e, 500);
  } finally {
    connection.release();
  }
};
