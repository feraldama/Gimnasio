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
// Para LECTURAS COMPARTIDAS entre pantallas usar `requireAnyPerm`: alcanza con
// tener el flag en CUALQUIERA de los recursos listados. Ej.: el catálogo de
// productos lo leen el POS (NUEVAVENTA), Inventario, Compras y Combos, no sólo
// la pantalla de Productos — exigir sólo "PRODUCTOS" dejaría al cajero sin
// poder vender.
//
//   router.get("/", requireAnyPerm(["PRODUCTOS", "NUEVAVENTA"], "leer"), ctrl.list);
//
// La acción también acepta un array cuando un mismo endpoint participa de dos
// flujos. Ej.: guardar un usuario borra y recrea sus filas de `usuarioperfil`
// tanto al CREAR como al EDITAR, así que el endpoint acepta cualquiera de las
// dos (quien puede crear un usuario ya puede darle el flag de admin, así que
// no es un debilitamiento real):
//
//   router.post("/", requirePerm("USUARIOS", ["crear", "editar"]), ctrl.create);
//
// SIEMPRE va después de `authMiddleware` (necesita req.user).
const db = require("../config/db");

const ACCION_TO_COL = {
  leer: "puedeLeer",
  crear: "puedeCrear",
  editar: "puedeEditar",
  eliminar: "puedeEliminar",
};

// Core compartido: `recursos` es la lista de MenuId aceptados (uno o varios) y
// `acciones` la lista de acciones aceptadas (alcanza con tener una).
function build(recursos, acciones, fnName) {
  const cols = acciones.map((a) => {
    const col = ACCION_TO_COL[a];
    if (!col) {
      throw new Error(
        `${fnName}: accion inválida '${a}'. Usar leer|crear|editar|eliminar.`
      );
    }
    return col;
  });
  if (!recursos.length) {
    throw new Error(`${fnName}: hay que indicar al menos un recurso.`);
  }
  if (!cols.length) {
    throw new Error(`${fnName}: hay que indicar al menos una accion.`);
  }
  for (const r of recursos) recursosDeclarados.add(r);
  const placeholders = recursos.map(() => "?").join(", ");
  const flagCond = cols.map((c) => `pm.${c} = 1`).join(" OR ");
  // Cualquier perfil del usuario que tenga alguna de las acciones en
  // cualquiera de los recursos → permite.
  const sql = `
    SELECT 1
    FROM usuarioperfil up
    JOIN perfilmenu pm ON pm.PerfilId = up.PerfilId
    WHERE up.UsuarioId = ?
      AND pm.MenuId IN (${placeholders})
      AND (${flagCond})
    LIMIT 1
  `;

  return (req, res, next) => {
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ success: false, message: "Usuario no autenticado" });
    }
    // Admin tiene bypass (igual que el frontend en usePermiso).
    if (req.user.isAdmin === "S") return next();

    db.query(sql, [req.user.id, ...recursos], (err, rows) => {
      if (err) {
        console.error(`${fnName}: error en consulta de permisos:`, err);
        return res
          .status(500)
          .json({ success: false, message: "Error verificando permisos" });
      }
      if (!rows || rows.length === 0) {
        return res.status(403).json({
          success: false,
          code: "FORBIDDEN",
          message: `Sin permiso ${acciones.join("/")} sobre ${recursos.join("/")}`,
        });
      }
      return next();
    });
  };
}

const asArray = (v) => (Array.isArray(v) ? v : [v]);

// Todo recurso que algún router haya declarado. Se llena cuando se cargan las
// rutas (los `requirePerm(...)` corren en el require del router) y sirve para
// el chequeo de arranque de abajo.
const recursosDeclarados = new Set();

// Avisa si un router pide permiso sobre un MenuId que no existe en la tabla
// `menu`. Ese error no falla: simplemente niega el permiso PARA SIEMPRE a todo
// perfil que no sea admin, y el síntoma (pantalla vacía o 403 sólo para
// algunos usuarios) no apunta a la causa. Ya pasó con REPORTECOBRANZA — ver el
// comentario de migrations/010-menu-reporte-cobranza.sql.
//
// Sólo avisa, nunca corta el arranque: un gimnasio no debe quedarse sin
// sistema por un menú faltante.
function verificarRecursosEnBD({ log = console } = {}) {
  const declarados = [...recursosDeclarados];
  if (!declarados.length) return Promise.resolve({ faltantes: [] });
  const placeholders = declarados.map(() => "?").join(", ");
  return new Promise((resolve) => {
    db.query(
      `SELECT MenuId FROM menu WHERE MenuId IN (${placeholders})`,
      declarados,
      (err, rows) => {
        if (err) {
          log.error(
            "No se pudo verificar los recursos de permisos contra la BD:",
            err.message
          );
          return resolve({ faltantes: [], error: err });
        }
        const enBD = new Set((rows || []).map((r) => r.MenuId));
        const faltantes = declarados.filter((r) => !enBD.has(r)).sort();
        if (faltantes.length) {
          log.warn(
            `⚠  Permisos: ${faltantes.length} recurso(s) usados en las rutas ` +
              `NO existen en la tabla \`menu\`: ${faltantes.join(", ")}. ` +
              "Todo perfil no admin va a recibir 403 en esos endpoints. " +
              "Registrarlos con una migración (ver migrations/010 como ejemplo)."
          );
        } else {
          log.log(
            `Permisos: ${declarados.length} recursos verificados contra la tabla \`menu\`.`
          );
        }
        resolve({ faltantes });
      }
    );
  });
}

// `accion` acepta un string o un array (alcanza con tener una de ellas).
function requirePerm(recurso, accion) {
  return build([recurso], asArray(accion), "requirePerm");
}

// Alcanza con tener el flag en cualquiera de los recursos.
function requireAnyPerm(recursos, accion) {
  if (!Array.isArray(recursos)) {
    throw new Error("requireAnyPerm: el primer argumento debe ser un array.");
  }
  return build(recursos, asArray(accion), "requireAnyPerm");
}

module.exports = requirePerm;
module.exports.requirePerm = requirePerm;
module.exports.requireAnyPerm = requireAnyPerm;
module.exports.verificarRecursosEnBD = verificarRecursosEnBD;
module.exports.recursosDeclarados = recursosDeclarados;
