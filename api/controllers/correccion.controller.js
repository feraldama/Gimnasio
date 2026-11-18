// Corrección de caja: ver turnos, ver un turno con sus ventas/cobros, y
// corregir (medio de cobro, anular venta, cargar venta faltante).
//
// Permisos (menú CORRECCIONCAJA, migración 023):
//   leer      → entrar a la pantalla (un cajero sólo ve sus propios turnos).
//   editar    → corregir movimientos de SU turno abierto.
//   eliminar  → supervisor: ver todos los turnos y corregir turnos cerrados
//               dentro del plazo CORRECCION_CAJA_DIAS (configuración, def. 7).
// Admin (UsuarioIsAdmin = 'S') es supervisor.
const db = require("../config/db");
const Configuracion = require("../models/configuracion.model");
const Correccion = require("../models/correccionCaja.model");
const { evaluarPermisoCorreccion, validarMotivo, MEDIOS } = require("../utils/correccionCaja");
const { turnoDeApertura, perteneceAlTurno } = require("../utils/turnoCaja");
const { todayLocalISO } = require("../utils/dateUtils");
const { sendError } = require("../utils/errors");

const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const PLAZO_DEFAULT = 7;
// Tope de id para "turno abierto" en un BETWEEN: la columna es integer, un
// Number.MAX_SAFE_INTEGER no entra y Postgres rechaza la consulta.
const ID_MAX = 2147483647;

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

async function conConexion(fn) {
  const conn = await db.promise().getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

async function enTransaccion(fn) {
  return conConexion(async (conn) => {
    await conn.beginTransaction();
    try {
      const r = await fn(conn);
      await conn.commit();
      return r;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    }
  });
}

function responderError(res, error, contextoLog) {
  if (error?.status) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(contextoLog, error);
  return sendError(res, error, 500);
}

// GET /correcciones/turnos?fecha=YYYY-MM-DD
// Turnos que cerraron en la fecha, más los que siguen abiertos, con TODOS sus
// movimientos desde la apertura. No alcanza con un margen de días fijo (como
// /registrodiariocaja/rango): un turno puede quedar abierto varios días, y sin
// su apertura el cliente no lo puede armar. El cliente arma los totales con
// utils/cierreCaja.ts. Un cajero sólo recibe sus propios turnos.
exports.getTurnos = async (req, res) => {
  try {
    const fecha = req.query.fecha || todayLocalISO();
    if (!RE_FECHA_ISO.test(fecha)) {
      return res.status(400).json({ message: "Fecha inválida (YYYY-MM-DD)" });
    }
    const data = await conConexion(async (conn) => {
      const ctx = await contexto(conn, req.user);
      const soloPropios = !ctx.esSupervisor;
      const filtroCierre = soloPropios ? "AND c.UsuarioId = ?" : "";
      const filtroApertura = soloPropios ? "AND a.UsuarioId = ?" : "";
      const params = [fecha];
      if (soloPropios) params.push(req.user.id);
      params.push(fecha);
      if (soloPropios) params.push(req.user.id);

      // Alias en snake_case a propósito: config/db.js sólo pasa a PascalCase las
      // columnas que salen directo de una tabla, no las calculadas (MAX, UNION).
      const [turnos] = await conn.query(
        `SELECT * FROM (
           SELECT (SELECT MAX(a.RegistroDiarioCajaId) FROM registrodiariocaja a
                   WHERE a.CajaId = c.CajaId AND a.UsuarioId = c.UsuarioId
                     AND a.TipoGastoId = 2 AND a.TipoGastoGrupoId = 2
                     AND a.RegistroDiarioCajaId < c.RegistroDiarioCajaId) AS ap_id,
                  c.RegistroDiarioCajaId AS ci_id, c.CajaId AS caja_id, c.UsuarioId AS usu_id
           FROM registrodiariocaja c
           WHERE c.TipoGastoId = 1 AND c.TipoGastoGrupoId = 2
             AND DATE(c.RegistroDiarioCajaFecha) = ?::date ${filtroCierre}
         ) cerrados
         WHERE ap_id IS NOT NULL
         UNION ALL
         SELECT a.RegistroDiarioCajaId AS ap_id, NULL::integer AS ci_id, a.CajaId AS caja_id, a.UsuarioId AS usu_id
         FROM registrodiariocaja a
         WHERE a.TipoGastoId = 2 AND a.TipoGastoGrupoId = 2
           AND DATE(a.RegistroDiarioCajaFecha) <= ?::date ${filtroApertura}
           AND NOT EXISTS (
             SELECT 1 FROM registrodiariocaja x
             WHERE x.CajaId = a.CajaId AND x.UsuarioId = a.UsuarioId
               AND x.TipoGastoId = 1 AND x.TipoGastoGrupoId = 2
               AND x.RegistroDiarioCajaId > a.RegistroDiarioCajaId
           )`,
        params
      );

      let registros = [];
      let correcciones = [];
      if (turnos.length) {
        // Misma regla que utils/turnoCaja.perteneceAlTurno.
        const conds = [];
        const p = [];
        for (const t of turnos) {
          conds.push(
            `(r.CajaId = ? AND r.UsuarioId = ? AND (r.AperturaRef = ? OR (r.AperturaRef IS NULL
               AND r.RegistroDiarioCajaId BETWEEN ? AND ?)))`
          );
          p.push(t.caja_id, t.usu_id, t.ap_id, t.ap_id, t.ci_id ?? ID_MAX);
        }
        [registros] = await conn.query(
          `SELECT r.*, c.CajaDescripcion, c.LocalId, u.UsuarioNombre
           FROM registrodiariocaja r
           LEFT JOIN caja c ON c.CajaId = r.CajaId
           LEFT JOIN usuario u ON u.UsuarioId = r.UsuarioId
           WHERE ${conds.join(" OR ")}
           ORDER BY r.RegistroDiarioCajaId ASC`,
          p
        );
        const ids = turnos.map((t) => t.ap_id);
        [correcciones] = await conn.query(
          `SELECT AperturaId, COUNT(*)::int AS cantidad
           FROM correccioncaja
           WHERE AperturaId IN (${ids.map(() => "?").join(", ")})
           GROUP BY AperturaId`,
          ids
        );
      }
      return {
        fecha,
        registros,
        correcciones,
        esSupervisor: ctx.esSupervisor,
        puedeEditarPropio: ctx.puedeEditarPropio,
        plazoDias: ctx.plazoDias,
        usuarioId: req.user.id,
      };
    });
    res.json(data);
  } catch (error) {
    responderError(res, error, "Error listando turnos para corrección:");
  }
};

// GET /correcciones/turno/:aperturaId
exports.getTurno = async (req, res) => {
  const aperturaId = Number(req.params.aperturaId);
  if (!Number.isInteger(aperturaId) || aperturaId <= 0) {
    return res.status(400).json({ message: "Turno inválido" });
  }
  try {
    const data = await conConexion(async (conn) => {
      const ctx = await contexto(conn, req.user);
      const turno = await turnoDeApertura(conn, aperturaId);
      if (!turno) return null;
      if (!ctx.esSupervisor && String(turno.usuarioId) !== String(req.user.id)) {
        const e = new Error("Sólo podés ver tus propios turnos");
        e.status = 403;
        throw e;
      }

      const [candidatos] = await conn.query(
        `SELECT r.*, c.CajaDescripcion, c.LocalId
         FROM registrodiariocaja r
         LEFT JOIN caja c ON c.CajaId = r.CajaId
         WHERE r.CajaId = ? AND r.UsuarioId = ?
           AND (r.AperturaRef = ? OR (r.AperturaRef IS NULL AND r.RegistroDiarioCajaId >= ?
                AND r.RegistroDiarioCajaId <= ?))
         ORDER BY r.RegistroDiarioCajaId ASC`,
        [
          turno.cajaId,
          turno.usuarioId,
          aperturaId,
          aperturaId,
          turno.cierreId ?? ID_MAX,
        ]
      );
      const registros = candidatos.filter((r) =>
        perteneceAlTurno(r, aperturaId, turno.cierreId)
      );

      const ventaIds = [...new Set(registros.map((r) => r.VentaId).filter((x) => x != null))];
      const pagoIds = [...new Set(registros.map((r) => r.PagoId).filter((x) => x != null))];

      let ventas = [];
      let items = [];
      if (ventaIds.length) {
        const ph = ventaIds.map(() => "?").join(", ");
        [ventas] = await conn.query(
          `SELECT v.VentaId, v.VentaFecha, v.VentaTipo, v.Total, v.VentaEntrega,
                  v.AlmacenId, c.ClienteNombre, c.ClienteApellido
           FROM venta v LEFT JOIN clientes c ON c.ClienteId = v.ClienteId
           WHERE v.VentaId IN (${ph})`,
          ventaIds
        );
        [items] = await conn.query(
          `SELECT vp.VentaId, vp.ProductoId, p.ProductoNombre,
                  vp.VentaProductoCantidad, vp.VentaProductoPrecioTotal
           FROM ventaproducto vp LEFT JOIN producto p ON p.ProductoId = vp.ProductoId
           WHERE vp.VentaId IN (${ph})
           ORDER BY vp.VentaId, vp.VentaProductoId`,
          ventaIds
        );
      }
      let pagos = [];
      if (pagoIds.length) {
        [pagos] = await conn.query(
          `SELECT p.PagoId, p.PagoTipo, p.PagoMonto, p.SuscripcionId, pl.PlanNombre,
                  c.ClienteNombre, c.ClienteApellido
           FROM pago p
           JOIN suscripcion s ON s.SuscripcionId = p.SuscripcionId
           LEFT JOIN clientes c ON c.ClienteId = s.ClienteId
           LEFT JOIN plan pl ON pl.PlanId = s.PlanId
           WHERE p.PagoId IN (${pagoIds.map(() => "?").join(", ")})`,
          pagoIds
        );
      }
      const [correcciones] = await conn.query(
        `SELECT k.*, u.UsuarioNombre
         FROM correccioncaja k
         LEFT JOIN usuario u ON u.UsuarioId = k.UsuarioId
         WHERE k.AperturaId = ?
         ORDER BY k.CorreccionCajaId DESC`,
        [aperturaId]
      );

      const permiso = ctx.autorizar(turno);
      return {
        turno: {
          aperturaId: turno.aperturaId,
          cierreId: turno.cierreId,
          abierto: turno.abierto,
          cajaId: turno.cajaId,
          cajaDescripcion: turno.apertura.CajaDescripcion,
          localId: Number(turno.apertura.LocalId) || 0,
          usuarioId: turno.usuarioId,
          usuarioNombre: turno.apertura.UsuarioNombre || null,
          aperturaFecha: turno.apertura.RegistroDiarioCajaFecha,
          cierreFecha: turno.cierreFecha,
        },
        registros,
        ventas: ventas.map((v) => ({
          ...v,
          Items: items.filter((i) => i.VentaId === v.VentaId),
        })),
        pagos,
        correcciones,
        puedeCorregir: permiso.ok,
        motivoNoCorregible: permiso.ok ? null : permiso.message,
        esSupervisor: ctx.esSupervisor,
        medios: MEDIOS,
      };
    });
    if (!data) return res.status(404).json({ message: "Turno no encontrado" });
    res.json(data);
  } catch (error) {
    responderError(res, error, "Error obteniendo turno para corrección:");
  }
};

// POST /correcciones/movimiento/:id/medio  { medio, motivo }
exports.cambiarMedio = async (req, res) => {
  const v = validarMotivo(req.body?.motivo);
  if (v.error) return res.status(400).json({ message: v.error });
  const medio = String(req.body?.medio || "");
  if (!MEDIOS.includes(medio)) {
    return res.status(400).json({ message: `Medio inválido: ${medio || "(vacío)"}` });
  }
  try {
    const r = await enTransaccion(async (conn) => {
      const ctx = await contexto(conn, req.user);
      return Correccion.cambiarMedioTx(conn, {
        registroId: Number(req.params.id),
        medio,
        motivo: v.motivo,
        usuarioId: req.user.id,
        autorizar: ctx.autorizar,
      });
    });
    res.json({ message: "Medio de cobro corregido", data: r });
  } catch (error) {
    responderError(res, error, "Error cambiando medio de cobro:");
  }
};

// POST /correcciones/venta/:id/anular  { motivo }
exports.anularVenta = async (req, res) => {
  const v = validarMotivo(req.body?.motivo);
  if (v.error) return res.status(400).json({ message: v.error });
  try {
    const r = await enTransaccion(async (conn) => {
      const ctx = await contexto(conn, req.user);
      return Correccion.anularVentaTx(conn, {
        ventaId: Number(req.params.id),
        motivo: v.motivo,
        usuarioId: req.user.id,
        autorizar: ctx.autorizar,
      });
    });
    res.json({ message: "Venta anulada", data: r });
  } catch (error) {
    responderError(res, error, "Error anulando venta:");
  }
};

/**
 * Valida el cuerpo de "cargar venta faltante". Exportado para tests.
 * Exige que lo cobrado sume exactamente el total de los productos: es una
 * carga hecha a posteriori por un supervisor y no hay POS que lo controle.
 */
function validarVentaFaltante(body = {}) {
  const Productos = Array.isArray(body.Productos) ? body.Productos : [];
  if (!Productos.length) return { error: "Agregá al menos un producto" };
  let totalProductos = 0;
  const limpios = [];
  for (const p of Productos) {
    const cantidad = Number(p.VentaProductoCantidad);
    const precioTotal = Math.round(Number(p.VentaProductoPrecioTotal));
    if (!Number(p.ProductoId) || !(cantidad > 0) || !(precioTotal >= 0)) {
      return { error: "Cada producto necesita producto, cantidad y precio" };
    }
    totalProductos += precioTotal;
    limpios.push({
      ProductoId: Number(p.ProductoId),
      VentaProductoCantidad: cantidad,
      VentaProductoPrecioTotal: precioTotal,
      ProductoUnidad: p.ProductoUnidad === "C" ? "C" : "U",
    });
  }
  const pagos = body.Pagos || {};
  const efectivo = Math.round(Number(pagos.Efectivo) || 0);
  const banco = Math.round(Number(pagos.Banco) || 0);
  const voucher = Math.round(Number(pagos.Voucher) || 0);
  const transferencia = Math.round(Number(pagos.Transferencia) || 0);
  const cuentaCliente = Math.round(Number(pagos.CuentaCliente) || 0);
  if ([efectivo, banco, voucher, transferencia, cuentaCliente].some((x) => x < 0)) {
    return { error: "Los montos no pueden ser negativos" };
  }
  const cobrado = efectivo + banco + voucher + transferencia + cuentaCliente;
  if (cobrado !== totalProductos) {
    return {
      error: `Lo cobrado (${cobrado}) no coincide con el total de los productos (${totalProductos})`,
    };
  }
  if (cuentaCliente > 0 && (!Number(body.ClienteId) || Number(body.ClienteId) === 1)) {
    return { error: "Una venta a cuenta necesita un cliente identificado" };
  }
  return {
    venta: {
      Productos: limpios,
      efectivo,
      banco,
      voucher,
      transferencia,
      cuentaCliente,
      ClienteId: Number(body.ClienteId) || 1,
      AlmacenOrigenId: Number(body.AlmacenOrigenId) || null,
    },
  };
}
exports.validarVentaFaltante = validarVentaFaltante;

// POST /correcciones/turno/:aperturaId/venta  { motivo, Productos, Pagos, ClienteId?, AlmacenOrigenId? }
exports.cargarVenta = async (req, res) => {
  const v = validarMotivo(req.body?.motivo);
  if (v.error) return res.status(400).json({ message: v.error });
  const vf = validarVentaFaltante(req.body);
  if (vf.error) return res.status(400).json({ message: vf.error });
  try {
    const r = await enTransaccion(async (conn) => {
      const ctx = await contexto(conn, req.user);
      return Correccion.cargarVentaEnTurnoTx(conn, {
        aperturaId: Number(req.params.aperturaId),
        motivo: v.motivo,
        usuarioId: req.user.id,
        autorizar: ctx.autorizar,
        venta: vf.venta,
      });
    });
    res.status(201).json({ message: "Venta cargada en el turno", data: r });
  } catch (error) {
    responderError(res, error, "Error cargando venta faltante:");
  }
};
