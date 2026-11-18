// Permisos de corrección de caja del usuario (menú CORRECCIONCAJA) y la
// función `autorizar(turno)` que usan los modelos. Lo comparten Corrección de
// caja (correccion.controller) y Registro Diario Caja (editar/borrar
// movimientos de turnos cerrados).
const Configuracion = require("../models/configuracion.model");
const { evaluarPermisoCorreccion } = require("./correccionCaja");
const { todayLocalISO } = require("./dateUtils");

const PLAZO_DEFAULT = 7;

async function tienePermiso(conn, usuarioId, menu, accion) {
  const col = { leer: "puedeLeer", editar: "puedeEditar", eliminar: "puedeEliminar" }[accion];
  const [rows] = await conn.query(
    `SELECT 1 FROM usuarioperfil up
     JOIN perfilmenu pm ON pm.PerfilId = up.PerfilId
     WHERE up.UsuarioId = ? AND pm.MenuId = ? AND pm.${col} = 1
     LIMIT 1`,
    [usuarioId, menu]
  );
  return rows.length > 0;
}

/** Permisos del usuario + función `autorizar(turno)` para el modelo. */
async function contexto(conn, user) {
  const esAdmin = user?.isAdmin === "S";
  const esSupervisor =
    esAdmin || (await tienePermiso(conn, user.id, "CORRECCIONCAJA", "eliminar"));
  const puedeEditarPropio =
    esSupervisor || (await tienePermiso(conn, user.id, "CORRECCIONCAJA", "editar"));
  const plazoDias = await Configuracion.getNumero("CORRECCION_CAJA_DIAS", PLAZO_DEFAULT);
  const hoyISO = todayLocalISO();

  const autorizar = (turno) => {
    // Venta/pago sin movimiento de caja, o cargado con la caja cerrada: no
    // es de ningún turno, sólo lo toca un supervisor.
    if (!turno) {
      return esSupervisor
        ? { ok: true }
        : {
            ok: false,
            status: 403,
            message: "Sólo un supervisor puede corregir movimientos fuera de turno",
          };
    }
    return evaluarPermisoCorreccion({
      turno,
      usuarioId: user.id,
      esSupervisor,
      puedeEditarPropio,
      hoyISO,
      plazoDias,
    });
  };

  return { esSupervisor, puedeEditarPropio, plazoDias, hoyISO, autorizar };
}

module.exports = { contexto, tienePermiso, PLAZO_DEFAULT };
