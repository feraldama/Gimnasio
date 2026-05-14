const db = require("../config/db");
const { todayLocalISO } = require("../utils/dateUtils");

const Asistencia = {
  /**
   * Determina si un cliente puede acceder hoy.
   * Devuelve un objeto descriptivo con permitido + motivo + datos del cliente y suscripción.
   */
  estadoAcceso: (clienteId) => {
    return new Promise((resolve, reject) => {
      const hoy = todayLocalISO();
      const sql = `
        SELECT
          c.ClienteId, c.ClienteNombre, c.ClienteApellido, c.ClienteTelefono,
          s.SuscripcionId, s.SuscripcionFechaInicio, s.SuscripcionFechaFin, s.SuscripcionEstado,
          p.PlanId, p.PlanNombre, p.PlanPermiteClases
        FROM clientes c
        LEFT JOIN suscripcion s
          ON s.ClienteId = c.ClienteId
          AND DATE(?) BETWEEN DATE(s.SuscripcionFechaInicio) AND DATE(s.SuscripcionFechaFin)
          AND s.SuscripcionEstado NOT IN ('C', 'S')
        LEFT JOIN plan p ON p.PlanId = s.PlanId
        WHERE c.ClienteId = ?
        ORDER BY s.SuscripcionFechaFin DESC
        LIMIT 1
      `;
      db.query(sql, [hoy, clienteId], (err, results) => {
        if (err) return reject(err);
        if (results.length === 0) {
          return resolve({
            permitido: false,
            motivo: "Cliente no encontrado",
            cliente: null,
            suscripcion: null,
          });
        }
        const r = results[0];
        const cliente = {
          ClienteId: r.ClienteId,
          ClienteNombre: r.ClienteNombre,
          ClienteApellido: r.ClienteApellido,
          ClienteTelefono: r.ClienteTelefono,
        };
        if (!r.SuscripcionId) {
          return resolve({
            permitido: false,
            motivo: "Sin suscripción activa",
            cliente,
            suscripcion: null,
          });
        }
        const suscripcion = {
          SuscripcionId: r.SuscripcionId,
          SuscripcionFechaInicio: r.SuscripcionFechaInicio,
          SuscripcionFechaFin: r.SuscripcionFechaFin,
          SuscripcionEstado: r.SuscripcionEstado,
          PlanId: r.PlanId,
          PlanNombre: r.PlanNombre,
          PlanPermiteClases: r.PlanPermiteClases,
        };
        const permiteClases =
          r.PlanPermiteClases === 1 || r.PlanPermiteClases === true;
        if (!permiteClases) {
          return resolve({
            permitido: false,
            motivo: "El plan no incluye acceso a clases",
            cliente,
            suscripcion,
          });
        }
        resolve({
          permitido: true,
          motivo: "Acceso permitido",
          cliente,
          suscripcion,
        });
      });
    });
  },

  registrar: (clienteId) => {
    return new Promise((resolve, reject) => {
      const hoy = todayLocalISO();
      const sql = `
        INSERT INTO asistencia (ClienteId, AsistenciaFecha, AsistenciaHoraEntrada)
        VALUES (?, ?, NOW())
      `;
      db.query(sql, [clienteId, hoy], (err, result) => {
        if (err) return reject(err);
        db.query(
          "SELECT * FROM asistencia WHERE AsistenciaId = ?",
          [result.insertId],
          (err2, rows) => {
            if (err2) return reject(err2);
            resolve(rows[0] || null);
          }
        );
      });
    });
  },

  /**
   * Devuelve las asistencias de la fecha dada (o de hoy si no se pasa).
   */
  listarPorFecha: (fecha) => {
    return new Promise((resolve, reject) => {
      const dia = fecha || todayLocalISO();
      const sql = `
        SELECT a.*,
          c.ClienteNombre, c.ClienteApellido, c.ClienteTelefono
        FROM asistencia a
        LEFT JOIN clientes c ON a.ClienteId = c.ClienteId
        WHERE DATE(a.AsistenciaFecha) = DATE(?)
        ORDER BY a.AsistenciaHoraEntrada DESC
      `;
      db.query(sql, [dia], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
  },

  /**
   * Ranking de asistencia por cliente en un rango de fechas.
   * Devuelve total de asistencias, días distintos y primera/última fecha.
   * Ordenado DESC por total. Útil para detectar clientes comprometidos
   * y los que están bajando frecuencia.
   */
  ranking: (fechaDesde, fechaHasta, limit = 50) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT
          c.ClienteId,
          c.ClienteNombre,
          c.ClienteApellido,
          c.ClienteTelefono,
          COUNT(*) AS cantidad,
          COUNT(DISTINCT a.AsistenciaFecha) AS diasDistintos,
          MIN(a.AsistenciaFecha) AS primeraFecha,
          MAX(a.AsistenciaFecha) AS ultimaFecha
        FROM asistencia a
        INNER JOIN clientes c ON c.ClienteId = a.ClienteId
        WHERE DATE(a.AsistenciaFecha) >= DATE(?)
          AND DATE(a.AsistenciaFecha) <= DATE(?)
        GROUP BY c.ClienteId, c.ClienteNombre, c.ClienteApellido, c.ClienteTelefono
        ORDER BY cantidad DESC, diasDistintos DESC
        LIMIT ?
      `;
      db.query(sql, [fechaDesde, fechaHasta, Number(limit)], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
  },

  /**
   * Cuántas asistencias tiene un cliente en el día dado (o hoy).
   * Para mostrar advertencia "Ya registró entrada hoy a las HH:MM" en UI.
   */
  asistenciaDelClienteHoy: (clienteId, fecha) => {
    return new Promise((resolve, reject) => {
      const dia = fecha || todayLocalISO();
      const sql = `
        SELECT AsistenciaId, AsistenciaHoraEntrada
        FROM asistencia
        WHERE ClienteId = ? AND DATE(AsistenciaFecha) = DATE(?)
        ORDER BY AsistenciaHoraEntrada DESC
        LIMIT 1
      `;
      db.query(sql, [clienteId, dia], (err, results) => {
        if (err) return reject(err);
        resolve(results[0] || null);
      });
    });
  },
};

module.exports = Asistencia;
