/**
 * Helpers para devolver errores al cliente sin exponer detalles internos
 * (stack traces, nombres de tabla, SQL, mensajes del driver).
 *
 * - Errores "seguros" (plain objects como `reject({ message: "..." })` lanzados
 *   intencionalmente desde los models para mostrar al usuario) se pasan tal cual.
 * - Errores de DB o Error nativos se ocultan tras un `fallback` genérico y el
 *   detalle queda en `console.error` del servidor.
 */

// Violaciones de UNIQUE de Postgres (SQLSTATE 23505) traducidas a algo que le
// sirva al operador. Sin esto, chocar contra una restriccion devuelve el
// fallback genérico ("Error interno") y quien está en el mostrador no tiene
// forma de saber que el problema es un dato repetido.
//
// La clave es el nombre de la restriccion, tal como la crea la migracion.
const MENSAJES_POR_CONSTRAINT = {
  uq_clientes_ruc_no_vacio:
    "Ya existe un cliente con esa cédula/RUC. Buscalo en el listado en vez " +
    "de darlo de alta otra vez.",
};

/**
 * Si `err` es una violación de unicidad, devuelve el mensaje para mostrar;
 * si no, devuelve null. Pensado para usar en el `catch` de un controlador:
 *
 *   const dup = mensajeConflictoUnico(error);
 *   if (dup) return res.status(409).json({ success: false, message: dup });
 */
function mensajeConflictoUnico(err) {
  if (!err || err.code !== "23505") return null;
  return (
    MENSAJES_POR_CONSTRAINT[err.constraint] ||
    "Ya existe un registro con esos datos."
  );
}

function isSafeMessage(err) {
  if (!err) return false;
  // mysql2 / mariadb errors: tienen estas props
  if (err.code || err.errno || err.sqlMessage || err.sqlState || err.sql) {
    return false;
  }
  // Plain objects con message string → errores de negocio propios
  if (!(err instanceof Error) && typeof err.message === "string") return true;
  return false;
}

function sendError(res, err, status = 500, fallback = "Error interno") {
  if (!isSafeMessage(err)) {
    console.error("API error:", err);
    return res.status(status).json({ message: fallback });
  }
  return res.status(status).json({ message: err.message });
}

module.exports = {
  isSafeMessage,
  sendError,
  mensajeConflictoUnico,
  MENSAJES_POR_CONSTRAINT,
};
