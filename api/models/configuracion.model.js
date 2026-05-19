const db = require("../config/db");

// Configuracion key-value. PK = ConfigClave (string). Entries are seeded by
// the migration; the UI lets admins edit ConfigValor for known claves.
const Configuracion = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM configuracion ORDER BY ConfigClave",
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });
  },

  getByClave: (clave) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM configuracion WHERE ConfigClave = ?",
        [clave],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.length > 0 ? results[0] : null);
        }
      );
    });
  },

  // Returns the numeric value of a key, or the provided fallback if the key
  // is absent or non-numeric. Used by report endpoints to read R and $T.
  getNumero: async (clave, fallback) => {
    const row = await Configuracion.getByClave(clave);
    if (!row) return fallback;
    const n = Number(row.ConfigValor);
    return Number.isFinite(n) ? n : fallback;
  },

  upsert: (data) => {
    return new Promise((resolve, reject) => {
      const clave = data.ConfigClave;
      const valor = data.ConfigValor ?? "";
      const descripcion = data.ConfigDescripcion ?? "";
      const tipo = data.ConfigTipo ?? "TEXTO";
      // ON CONFLICT keeps this atomic; the adapter doesn't append RETURNING for
      // composite/text PKs, so we follow up with a SELECT.
      const sql = `
        INSERT INTO configuracion (ConfigClave, ConfigValor, ConfigDescripcion, ConfigTipo)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (configclave) DO UPDATE SET
          configvalor = EXCLUDED.configvalor,
          configdescripcion = EXCLUDED.configdescripcion,
          configtipo = EXCLUDED.configtipo
      `;
      db.query(sql, [clave, valor, descripcion, tipo], async (err) => {
        if (err) return reject(err);
        const row = await Configuracion.getByClave(clave);
        resolve(row);
      });
    });
  },

  update: (clave, data) => {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      if (data.ConfigValor !== undefined) {
        fields.push("ConfigValor = ?");
        values.push(String(data.ConfigValor));
      }
      if (data.ConfigDescripcion !== undefined) {
        fields.push("ConfigDescripcion = ?");
        values.push(data.ConfigDescripcion);
      }
      if (data.ConfigTipo !== undefined) {
        fields.push("ConfigTipo = ?");
        values.push(data.ConfigTipo);
      }
      if (fields.length === 0) return resolve(null);
      values.push(clave);
      db.query(
        `UPDATE configuracion SET ${fields.join(", ")} WHERE ConfigClave = ?`,
        values,
        async (err, result) => {
          if (err) return reject(err);
          if (result.affectedRows === 0) return resolve(null);
          const row = await Configuracion.getByClave(clave);
          resolve(row);
        }
      );
    });
  },

  delete: (clave) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM configuracion WHERE ConfigClave = ?",
        [clave],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        }
      );
    });
  },
};

module.exports = Configuracion;
