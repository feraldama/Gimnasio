const db = require("../config/db");

const TipoGastoGrupo = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query("SELECT * FROM tipogastogrupo", (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });
  },

  getById: (tipoGastoId, grupoId) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM tipogastogrupo WHERE TipoGastoId = ? AND TipoGastoGrupoId = ?",
        [tipoGastoId, grupoId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.length > 0 ? results[0] : null);
        }
      );
    });
  },

  getByTipoGastoId: (tipoGastoId) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM tipogastogrupo WHERE TipoGastoId = ?",
        [tipoGastoId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });
  },

  create: (data) => {
    return new Promise((resolve, reject) => {
      // 1. Calcular el próximo grupoid como MAX(actual) + 1. Antes usábamos
      //    el contador `TipoGastoCantGastos`, pero si el contador queda
      //    desincronizado con la realidad (p. ej. seeds que insertan grupos
      //    sin incrementar el contador), el siguiente create choca contra la
      //    PK compuesta (tipogastoid, tipogastogrupoid). MAX es la fuente
      //    autoritativa.
      db.query(
        "SELECT COALESCE(MAX(TipoGastoGrupoId), 0) AS maxid FROM tipogastogrupo WHERE TipoGastoId = ?",
        [data.TipoGastoId],
        (err, results) => {
          if (err) return reject(err);
          const nextGrupoId = Number(results[0]?.maxid || 0) + 1;
          // 2. Insertar con el nuevo ID
          db.query(
            "INSERT INTO tipogastogrupo (TipoGastoId, TipoGastoGrupoId, TipoGastoGrupoDescripcion) VALUES (?, ?, ?)",
            [data.TipoGastoId, nextGrupoId, data.TipoGastoGrupoDescripcion],
            (err) => {
              if (err) return reject(err);
              // 3. Mantener el contador sincronizado para queries que aún lo lean.
              //    Lo seteamos al máximo (no a `count`) para que coincida con la
              //    semántica histórica de "último id usado".
              db.query(
                "UPDATE TipoGasto SET TipoGastoCantGastos = ? WHERE TipoGastoId = ?",
                [nextGrupoId, data.TipoGastoId],
                (err2) => {
                  if (err2) return reject(err2);
                  TipoGastoGrupo.getById(data.TipoGastoId, nextGrupoId)
                    .then((grupo) => resolve(grupo))
                    .catch((error) => reject(error));
                }
              );
            }
          );
        }
      );
    });
  },

  update: (id, data) => {
    return new Promise((resolve, reject) => {
      // Primero verificar si hay registros dependientes
      db.query(
        "SELECT COUNT(*) as count FROM registrodiariocaja WHERE TipoGastoId = ? AND TipoGastoGrupoId = ?",
        [data.TipoGastoId, id],
        (err, results) => {
          if (err) return reject(err);

          if (results[0].count > 0) {
            return reject({
              message:
                "No se puede actualizar este grupo porque tiene gastos asociados en caja",
            });
          }

          // Si no hay dependencias, proceder con la actualización
          db.query(
            "UPDATE tipogastogrupo SET TipoGastoGrupoDescripcion = ? WHERE TipoGastoGrupoId = ? AND TipoGastoId = ?",
            [data.TipoGastoGrupoDescripcion, id, data.TipoGastoId],
            (err) => {
              if (err) return reject(err);
              TipoGastoGrupo.getById(data.TipoGastoId, id)
                .then((grupo) => resolve(grupo))
                .catch((error) => reject(error));
            }
          );
        }
      );
    });
  },

  delete: (tipoGastoId, grupoId) => {
    return new Promise((resolve, reject) => {
      // Obtener el grupo antes de eliminarlo para saber el TipoGastoId
      db.query(
        "SELECT TipoGastoId FROM tipogastogrupo WHERE TipoGastoId = ? AND TipoGastoGrupoId = ?",
        [tipoGastoId, grupoId],
        (err, results) => {
          if (err) return reject(err);
          const tipoGastoIdFound = results[0]?.TipoGastoId;
          // Verificar si hay registros dependientes
          db.query(
            "SELECT COUNT(*) as count FROM registrodiariocaja WHERE TipoGastoId = ? AND TipoGastoGrupoId = ?",
            [tipoGastoId, grupoId],
            (err, results) => {
              if (err) return reject(err);
              if (results[0].count > 0) {
                return reject({
                  message:
                    "No se puede eliminar este grupo porque tiene gastos asociados en caja",
                });
              }
              // Si no hay dependencias, proceder con la eliminación
              db.query(
                "DELETE FROM tipogastogrupo WHERE TipoGastoId = ? AND TipoGastoGrupoId = ?",
                [tipoGastoId, grupoId],
                (err, result) => {
                  if (err) return reject(err);
                  if (tipoGastoIdFound) {
                    db.query(
                      "UPDATE TipoGasto SET TipoGastoCantGastos = TipoGastoCantGastos - 1 WHERE TipoGastoId = ? AND TipoGastoCantGastos > 0",
                      [tipoGastoIdFound],
                      (err2) => {
                        if (err2) return reject(err2);
                        resolve(
                          result.affectedRows > 0 ? tipoGastoIdFound : false
                        );
                      }
                    );
                  } else {
                    resolve(result.affectedRows > 0);
                  }
                }
              );
            }
          );
        }
      );
    });
  },
};

module.exports = TipoGastoGrupo;
