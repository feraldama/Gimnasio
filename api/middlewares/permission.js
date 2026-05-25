// Middleware factory para chequear permisos finos (recurso + acción).
//
// El frontend tiene `usePermiso("RECURSO", "leer")` que decide qué botones
// mostrar, pero hasta ahora el backend sólo validaba autenticación. Cualquiera
// con un JWT podía llamar `DELETE /api/pagos/:id` por curl aunque su perfil
// no tuviera el flag — la UI lo escondía, el backend lo dejaba pasar.
//
// Este middleware espeja la lógica de `usePermiso`:
//   - Bypass para isAdmin === 'S' (admin todo poderoso).
//   - El resto: hace JOIN usuarioperfil → perfilmenu y chequea el flag.
//
// Uso:
//   router.get("/", authMiddleware, requirePerm("PAGOS", "leer"), ctrl.list);
//   router.delete("/:id", authMiddleware, requirePerm("PAGOS", "eliminar"), ctrl.remove);
//
// SIEMPRE va después de `authMiddleware` (necesita req.user).
const db = require("../config/db");

const ACCION_TO_COL = {
  leer: "puedeLeer",
  crear: "puedeCrear",
  editar: "puedeEditar",
  eliminar: "puedeEliminar",
};

function requirePerm(recurso, accion) {
  const colFlag = ACCION_TO_COL[accion];
  if (!colFlag) {
    throw new Error(
      `requirePerm: accion inválida '${accion}'. Usar leer|crear|editar|eliminar.`
    );
  }
  return (req, res, next) => {
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ success: false, message: "Usuario no autenticado" });
    }
    // Admin tiene bypass (igual que el frontend en usePermiso).
    if (req.user.isAdmin === "S") return next();

    // Cualquier perfil del usuario que tenga el flag → permite.
    const sql = `
      SELECT 1
      FROM usuarioperfil up
      JOIN perfilmenu pm ON pm.PerfilId = up.PerfilId
      WHERE up.UsuarioId = ?
        AND pm.MenuId = ?
        AND pm.${colFlag} = 1
      LIMIT 1
    `;
    db.query(sql, [req.user.id, recurso], (err, rows) => {
      if (err) {
        console.error("requirePerm: error en consulta de permisos:", err);
        return res
          .status(500)
          .json({ success: false, message: "Error verificando permisos" });
      }
      if (!rows || rows.length === 0) {
        return res.status(403).json({
          success: false,
          code: "FORBIDDEN",
          message: `Sin permiso ${accion} sobre ${recurso}`,
        });
      }
      return next();
    });
  };
}

module.exports = requirePerm;
