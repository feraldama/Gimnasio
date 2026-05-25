const db = require("../config/db");

const CanchaBloqueo = {
  // Lista bloqueos en un rango de fechas (inclusive). Incluye el nombre de
  // cancha o "Todas las canchas" si CanchaId es NULL.
  listByRango: (desde, hasta) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT b.*, c.CanchaNombre
        FROM cancha_bloqueo b
        LEFT JOIN cancha c ON c.CanchaId = b.CanchaId
        WHERE b.CanchaBloqueoFecha BETWEEN ? AND ?
        ORDER BY b.CanchaBloqueoFecha ASC,
                 b.CanchaBloqueoHoraDesde NULLS FIRST,
                 b.CanchaBloqueoId ASC
      `;
      db.query(sql, [desde, hasta], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        `SELECT b.*, c.CanchaNombre
         FROM cancha_bloqueo b
         LEFT JOIN cancha c ON c.CanchaId = b.CanchaId
         WHERE b.CanchaBloqueoId = ?`,
        [id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.length ? rows[0] : null);
        }
      );
    });
  },

  // Bloqueos que aplican a una fecha + cancha. Un bloqueo aplica si:
  //   - su fecha coincide
  //   - canchaid es NULL (bloquea todas) o coincide con la cancha
  // El filtro de horario lo hace verificarSolape (más abajo).
  getAplicables: (canchaId, fecha) => {
    return new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM cancha_bloqueo
         WHERE CanchaBloqueoFecha = ?
           AND (CanchaId IS NULL OR CanchaId = ?)
         ORDER BY CanchaBloqueoId ASC`,
        [fecha, canchaId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  create: (data) => {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO cancha_bloqueo
        (CanchaId, CanchaBloqueoFecha, CanchaBloqueoHoraDesde,
         CanchaBloqueoHoraHasta, CanchaBloqueoMotivo, UsuarioId)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      db.query(
        sql,
        [
          data.CanchaId || null,
          data.CanchaBloqueoFecha,
          data.CanchaBloqueoHoraDesde || null,
          data.CanchaBloqueoHoraHasta || null,
          data.CanchaBloqueoMotivo || "",
          data.UsuarioId || null,
        ],
        (err, result) => {
          if (err) return reject(err);
          CanchaBloqueo.getById(result.insertId).then(resolve).catch(reject);
        }
      );
    });
  },

  update: (id, data) => {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      const cols = [
        "CanchaId",
        "CanchaBloqueoFecha",
        "CanchaBloqueoHoraDesde",
        "CanchaBloqueoHoraHasta",
        "CanchaBloqueoMotivo",
      ];
      cols.forEach((c) => {
        if (data[c] !== undefined) {
          fields.push(`${c} = ?`);
          // null explícito para horas vacías (todo el día) y CanchaId vacío
          // (bloqueo global). El "" textual no nos sirve.
          const v =
            data[c] === "" &&
            (c === "CanchaBloqueoHoraDesde" ||
              c === "CanchaBloqueoHoraHasta" ||
              c === "CanchaId")
              ? null
              : data[c];
          values.push(v);
        }
      });
      if (fields.length === 0) return resolve(null);
      values.push(id);
      db.query(
        `UPDATE cancha_bloqueo SET ${fields.join(", ")} WHERE CanchaBloqueoId = ?`,
        values,
        async (err, result) => {
          if (err) return reject(err);
          if (result.affectedRows === 0) return resolve(null);
          resolve(await CanchaBloqueo.getById(id));
        }
      );
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM cancha_bloqueo WHERE CanchaBloqueoId = ?",
        [id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        }
      );
    });
  },
};

module.exports = CanchaBloqueo;
