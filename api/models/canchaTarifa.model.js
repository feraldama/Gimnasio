const db = require("../config/db");

const toInt01 = (v) => (v === true || v === 1 || v === "1" ? 1 : 0);

// Sigla del dia de semana para un Date dado (JS getDay: 0=Dom..6=Sab).
// Letras: L,M,X,J,V,S,D (lunes, martes, miercoles, jueves, viernes, sabado, domingo).
const SIGLA_DIA = ["D", "L", "M", "X", "J", "V", "S"];

function siglaDia(date) {
  return SIGLA_DIA[date.getDay()];
}

const CanchaTarifa = {
  // Devuelve todas las tarifas de una cancha ordenadas para mostrar.
  getByCancha: (canchaId) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM cancha_tarifa
        WHERE CanchaId = ?
        ORDER BY CanchaTarifaActiva DESC, CanchaTarifaPrioridad DESC,
                 CanchaTarifaHoraDesde ASC
      `;
      db.query(sql, [canchaId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM cancha_tarifa WHERE CanchaTarifaId = ?",
        [id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.length ? rows[0] : null);
        }
      );
    });
  },

  create: (data) => {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO cancha_tarifa (
          CanchaId, CanchaTarifaNombre, CanchaTarifaDiasSemana,
          CanchaTarifaHoraDesde, CanchaTarifaHoraHasta,
          CanchaTarifaPrecio, CanchaTarifaPrioridad, CanchaTarifaActiva
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        data.CanchaId,
        data.CanchaTarifaNombre || "",
        data.CanchaTarifaDiasSemana || "L,M,X,J,V,S,D",
        data.CanchaTarifaHoraDesde || "00:00",
        data.CanchaTarifaHoraHasta || "23:59",
        data.CanchaTarifaPrecio ?? 0,
        data.CanchaTarifaPrioridad ?? 0,
        toInt01(data.CanchaTarifaActiva ?? 1),
      ];
      db.query(sql, values, (err, result) => {
        if (err) return reject(err);
        CanchaTarifa.getById(result.insertId).then(resolve).catch(reject);
      });
    });
  },

  update: (id, data) => {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      const cols = [
        "CanchaTarifaNombre",
        "CanchaTarifaDiasSemana",
        "CanchaTarifaHoraDesde",
        "CanchaTarifaHoraHasta",
        "CanchaTarifaPrecio",
        "CanchaTarifaPrioridad",
      ];
      cols.forEach((c) => {
        if (data[c] !== undefined) {
          fields.push(`${c} = ?`);
          values.push(data[c]);
        }
      });
      if (data.CanchaTarifaActiva !== undefined) {
        fields.push("CanchaTarifaActiva = ?");
        values.push(toInt01(data.CanchaTarifaActiva));
      }
      if (fields.length === 0) return resolve(null);
      values.push(id);
      db.query(
        `UPDATE cancha_tarifa SET ${fields.join(", ")} WHERE CanchaTarifaId = ?`,
        values,
        async (err, result) => {
          if (err) return reject(err);
          if (result.affectedRows === 0) return resolve(null);
          const r = await CanchaTarifa.getById(id);
          resolve(r);
        }
      );
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM cancha_tarifa WHERE CanchaTarifaId = ?",
        [id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        }
      );
    });
  },

  // Encuentra la banda aplicable para una fecha + hora puntual. Si varias
  // bandas matchean, gana la de mayor prioridad (y luego la mas reciente).
  // Devuelve la tarifa o null si no aplica ninguna.
  bandaAplicable: (canchaId, fechaISO, horaHHMM) => {
    return new Promise((resolve, reject) => {
      // fechaISO viene como "YYYY-MM-DD". Lo parseamos como local para tener
      // el día de semana correcto sin saltos de zona.
      const [y, m, d] = String(fechaISO).split("T")[0].split("-").map(Number);
      const date = new Date(y, m - 1, d);
      const dia = siglaDia(date);
      const sql = `
        SELECT * FROM cancha_tarifa
        WHERE CanchaId = ?
          AND CanchaTarifaActiva = 1
          AND CanchaTarifaDiasSemana LIKE ?
          AND CanchaTarifaHoraDesde <= ?
          AND CanchaTarifaHoraHasta > ?
        ORDER BY CanchaTarifaPrioridad DESC, CanchaTarifaId DESC
        LIMIT 1
      `;
      db.query(
        sql,
        [canchaId, `%${dia}%`, horaHHMM, horaHHMM],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.length ? rows[0] : null);
        }
      );
    });
  },
};

module.exports = { CanchaTarifa, siglaDia };
