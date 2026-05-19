const db = require("../config/db");

// Postgres almacena los 4 flags de permisos como SMALLINT (0/1). El frontend
// manda booleanos JS — pg rechaza `true`/`false` para SMALLINT. Normalizamos.
const toInt01 = (v) => (v === true || v === 1 || v === "1" ? 1 : 0);

const PerfilMenu = {
  getByPerfil: (perfilId) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM perfilmenu WHERE PerfilId = ?",
        [perfilId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });
  },
  getPermisosByUsuarioId: (usuarioId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT m.MenuNombre, pm.puedeCrear, pm.puedeEditar, pm.puedeEliminar, pm.puedeLeer
        FROM usuarioperfil up
        JOIN perfilmenu pm ON up.PerfilId = pm.PerfilId
        JOIN menu m ON pm.MenuId = m.MenuId
        WHERE up.UsuarioId = ?
      `;
      db.query(query, [usuarioId], (err, results) => {
        if (err) return reject(err);
        const permisos = {};
        results.forEach((row) => {
          permisos[row.MenuNombre] = {
            crear: !!row.puedeCrear,
            editar: !!row.puedeEditar,
            eliminar: !!row.puedeEliminar,
            leer: !!row.puedeLeer,
          };
        });
        resolve(permisos);
      });
    });
  },
  create: (data) => {
    return new Promise((resolve, reject) => {
      db.query(
        "INSERT INTO perfilmenu (PerfilId, MenuId, puedeCrear, puedeEditar, puedeEliminar, puedeLeer) VALUES (?, ?, ?, ?, ?, ?)",
        [
          data.PerfilId,
          data.MenuId,
          toInt01(data.puedeCrear),
          toInt01(data.puedeEditar),
          toInt01(data.puedeEliminar),
          toInt01(data.puedeLeer),
        ],
        (err, result) => {
          if (err) return reject(err);
          resolve({ PerfilMenuId: result.insertId, ...data });
        }
      );
    });
  },
  update: (perfilId, menuId, data) => {
    return new Promise((resolve, reject) => {
      db.query(
        "UPDATE perfilmenu SET puedeCrear=?, puedeEditar=?, puedeEliminar=?, puedeLeer=? WHERE PerfilId=? AND MenuId=?",
        [
          toInt01(data.puedeCrear),
          toInt01(data.puedeEditar),
          toInt01(data.puedeEliminar),
          toInt01(data.puedeLeer),
          perfilId,
          menuId,
        ],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },
  delete: (perfilId, menuId) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM perfilmenu WHERE PerfilId=? AND MenuId=?",
        [perfilId, menuId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },
};

module.exports = PerfilMenu;
