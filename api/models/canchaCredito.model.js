const db = require("../config/db");

const CanchaCredito = {
  // Créditos pendientes (saldo > 0) de un cliente, con datos de la reserva
  // para mostrar contexto (fecha, cancha, monto original).
  getPendientesByCliente: (clienteId) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT cc.*,
          r.CanchaReservaFecha,
          r.CanchaReservaHoraInicio,
          r.CanchaReservaHoraFin,
          r.CanchaId,
          ca.CanchaNombre
        FROM cancha_credito cc
        LEFT JOIN cancha_reserva r ON r.CanchaReservaId = cc.CanchaReservaId
        LEFT JOIN cancha ca ON ca.CanchaId = r.CanchaId
        WHERE cc.ClienteId = ? AND cc.CanchaCreditoSaldo > 0
        ORDER BY cc.CanchaCreditoFecha ASC
      `;
      db.query(sql, [clienteId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  // Trae un crédito por id con su saldo actualizado. Usado al cobrar para
  // chequear que no se intente pagar más que lo que se debe.
  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM cancha_credito WHERE CanchaCreditoId = ?",
        [id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.length ? rows[0] : null);
        }
      );
    });
  },

  // Historial de pagos de un crédito (para mostrar al usuario lo que ya se
  // cobró). Ordenado por id ascendente para mantener la secuencia natural.
  getPagosByCredito: (canchaCreditoId) => {
    return new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM cancha_credito_pago
         WHERE CanchaCreditoId = ?
         ORDER BY CanchaCreditoPagoId ASC`,
        [canchaCreditoId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },
};

module.exports = CanchaCredito;
