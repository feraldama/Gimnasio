const CanchaCredito = require("../models/canchaCredito.model");
const db = require("../config/db");
const { sendError } = require("../utils/errors");
const { PAGO_TIPOS, getLabel } = require("../constants/pagoTipos");

// Mismo grupo COBRO CANCHA (7) que usa el cobro inicial de reserva, para que
// los reportes que filtran por TipoGastoGrupoId=7 cuenten también los pagos
// posteriores de cuotas pendientes. El método queda en el detalle.
const TIPO_GASTO_GRUPO_COBRO_CANCHA = 7;
const METODOS_EFECTIVO = new Set(["CO"]);

// Lista créditos con saldo > 0 de un cliente. Llamado desde /credito-pagos
// en el tab "Cancha".
exports.listarPendientesPorCliente = async (req, res) => {
  try {
    const clienteId = parseInt(req.params.clienteId, 10);
    if (!Number.isFinite(clienteId)) {
      return res.status(400).json({ message: "ClienteId inválido" });
    }
    const creditos = await CanchaCredito.getPendientesByCliente(clienteId);
    res.json({ data: creditos });
  } catch (e) {
    console.error("Error listando créditos cancha:", e);
    sendError(res, e, 500);
  }
};

// Recibe un pago contra un crédito de cancha. Body: { pagos: [{tipo, monto}, ...] }
// donde NO se permite CR (no podés pagar una deuda generando otra deuda).
exports.cobrarCredito = async (req, res) => {
  const creditoId = parseInt(req.params.id, 10);
  const { pagos } = req.body || {};

  if (!Number.isFinite(creditoId)) {
    return res.status(400).json({ success: false, message: "Id inválido" });
  }
  if (!Array.isArray(pagos) || pagos.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Debe enviar al menos un método de pago en `pagos`.",
    });
  }
  for (const p of pagos) {
    if (!p || !PAGO_TIPOS[p.tipo]) {
      return res.status(400).json({
        success: false,
        message: `Tipo de pago inválido: ${p?.tipo}`,
      });
    }
    if (p.tipo === "CR") {
      return res.status(400).json({
        success: false,
        message: "No se puede pagar un crédito generando otro crédito.",
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

    const [creditoRows] = await connection.query(
      "SELECT * FROM cancha_credito WHERE CanchaCreditoId = ?",
      [creditoId]
    );
    if (creditoRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Crédito no encontrado" });
    }
    const credito = creditoRows[0];
    const saldoActual = Number(credito.CanchaCreditoSaldo) || 0;

    if (saldoActual <= 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "SIN_SALDO",
        message: "Este crédito ya está cancelado.",
      });
    }
    if (totalPagado > saldoActual) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        code: "MONTO_EXCEDE",
        message: `El monto a cobrar (Gs. ${totalPagado}) supera el saldo pendiente (Gs. ${saldoActual}).`,
      });
    }

    // Caja abierta del usuario (mismo check que el cobro inicial).
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
    const fechaMov = new Date();

    // Próximo PagoId de este crédito (PK compuesta).
    const [maxRows] = await connection.query(
      "SELECT COALESCE(MAX(CanchaCreditoPagoId), 0) AS m FROM cancha_credito_pago WHERE CanchaCreditoId = ?",
      [creditoId]
    );
    let nextPagoId = Number(maxRows[0]?.m || 0);

    // Cliente para el detalle del movimiento (lo recuperamos para que el
    // texto en registrodiariocaja sea consistente con el del cobro inicial).
    const [resInfo] = await connection.query(
      `SELECT c.ClienteNombre, c.ClienteApellido
       FROM clientes c WHERE c.ClienteId = ?`,
      [credito.ClienteId]
    );
    const clienteNombre =
      [resInfo[0]?.ClienteNombre, resInfo[0]?.ClienteApellido]
        .filter(Boolean)
        .join(" ")
        .trim() || `Cliente #${credito.ClienteId}`;

    const truncar = (s, n) => (s && s.length > n ? s.slice(0, n) : s || "");

    let efectivoTotal = 0;
    for (const p of pagos) {
      const monto = Math.round(Number(p.monto));
      const tipo = p.tipo;
      const metodo = getLabel(tipo);
      // Formato consistente con cobro inicial: "<Método> <CLIENTE> #<reservaId>".
      // Acá el #id es de la RESERVA original (para vincular visualmente con
      // el cobro original en el registro de caja).
      const sufijo = ` #${credito.CanchaReservaId}`;
      const presupuesto = 50 - metodo.length - 1 - sufijo.length;
      const cli = truncar(clienteNombre, Math.max(0, presupuesto));
      const detalle = truncar(`${metodo} ${cli}${sufijo}`, 50);

      await connection.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
          RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, 2, ?, ?, ?, ?)`,
        [cajaId, fechaMov, TIPO_GASTO_GRUPO_COBRO_CANCHA, detalle, monto, usuarioId]
      );

      nextPagoId += 1;
      await connection.query(
        `INSERT INTO cancha_credito_pago
         (CanchaCreditoId, CanchaCreditoPagoId, CanchaCreditoPagoFecha,
          CanchaCreditoPagoMonto, CanchaCreditoPagoTipo, UsuarioId)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [creditoId, nextPagoId, fechaMov, monto, tipo, usuarioId]
      );

      if (METODOS_EFECTIVO.has(tipo)) efectivoTotal += monto;
    }

    // Decrementar saldo + incrementar contador de pagos.
    await connection.query(
      `UPDATE cancha_credito
       SET CanchaCreditoSaldo = CanchaCreditoSaldo - ?,
           CanchaCreditoPagoCant = CanchaCreditoPagoCant + ?
       WHERE CanchaCreditoId = ?`,
      [totalPagado, pagos.length, creditoId]
    );

    if (efectivoTotal > 0) {
      await connection.query(
        "UPDATE Caja SET CajaMonto = CajaMonto + ? WHERE CajaId = ?",
        [efectivoTotal, cajaId]
      );
    }

    await connection.commit();
    const refrescado = await CanchaCredito.getById(creditoId);
    res.json({
      success: true,
      data: refrescado,
      cobro: {
        totalPagado,
        efectivoSumadoACaja: efectivoTotal,
        saldoRestante: refrescado.CanchaCreditoSaldo,
      },
    });
  } catch (e) {
    try {
      await connection.rollback();
    } catch (_) {
      /* ignorado */
    }
    console.error("Error al cobrar crédito cancha:", e);
    sendError(res, e, 500);
  } finally {
    connection.release();
  }
};
