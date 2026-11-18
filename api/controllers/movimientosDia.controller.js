// Consulta de solo lectura: ventas y cobros de gimnasio cargados en el día.
//
// Motivo: el error más común que reporta el cliente es que el cajero no sabe
// si algo ya se cargó (ej. "un Monster que se vendió a la mañana") y termina
// duplicándolo u olvidándolo. Hasta ahora sólo veía su propio turno, al
// cerrar, y sin productos.
//
// Alcance:
//   - Usuarios comunes: SOLO hoy y SOLO su local (todos los turnos, para que
//     la tarde vea lo de la mañana). No es una puerta al historial.
//   - Admin (UsuarioIsAdmin = 'S'): puede elegir `?fecha=` y `?localId=`.
//   - Usuario con LocalId 0 ("TODOS"): ve todos los locales, o filtra por
//     `?localId=`.
//
// El local de una venta es su almacén (v.AlmacenId, igual que el reporte
// "Resumen por local"); el de un pago, el local del usuario que lo cobró.
const db = require("../config/db");
const { resolverAlcance } = require("../utils/movimientosDia");
const { sendError } = require("../utils/errors");

function queryAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

exports.getDelDia = async (req, res) => {
  try {
    const alcance = resolverAlcance(req.user, req.query);
    if (alcance.error) {
      return res.status(400).json({ message: alcance.error });
    }
    const { fecha, localId } = alcance;

    const filtroVentaLocal = localId ? "AND v.AlmacenId = ?" : "";
    const paramsVenta = localId ? [fecha, localId] : [fecha];
    const filtroPagoLocal = localId ? "AND COALESCE(u.LocalId, 0) = ?" : "";
    const paramsPago = localId ? [fecha, localId] : [fecha];

    const sqlVentas = `
      SELECT v.VentaId, v.VentaFecha, v.VentaTipo, v.Total, v.VentaEntrega,
             v.AlmacenId, v.VentaUsuario, u.UsuarioNombre,
             c.ClienteNombre, c.ClienteApellido
      FROM venta v
      LEFT JOIN clientes c ON c.ClienteId = v.ClienteId
      LEFT JOIN usuario u ON u.UsuarioId = v.VentaUsuario
      WHERE DATE(v.VentaFecha) = ?::date ${filtroVentaLocal}
      ORDER BY v.VentaFecha DESC, v.VentaId DESC
    `;
    const sqlItems = `
      SELECT vp.VentaId, vp.ProductoId, p.ProductoNombre,
             vp.VentaProductoCantidad, vp.VentaProductoUnitario,
             vp.VentaProductoPrecioTotal
      FROM ventaproducto vp
      JOIN venta v ON v.VentaId = vp.VentaId
      LEFT JOIN producto p ON p.ProductoId = vp.ProductoId
      WHERE DATE(v.VentaFecha) = ?::date ${filtroVentaLocal}
      ORDER BY vp.VentaId, vp.VentaProductoId
    `;
    // Movimientos de caja de esas ventas: dicen con qué medio se cobró y en
    // qué caja. Una venta cobrada sin movimientos se hizo con la caja cerrada.
    const sqlMovVentas = `
      SELECT r.VentaId, r.TipoGastoGrupoId, r.RegistroDiarioCajaMonto,
             r.CajaId, ca.CajaDescripcion
      FROM registrodiariocaja r
      JOIN venta v ON v.VentaId = r.VentaId
      LEFT JOIN caja ca ON ca.CajaId = r.CajaId
      WHERE r.TipoGastoId = 2
        -- Ojo: config/db.js reescribe "<col> LIKE"; un "NOT LIKE" suelto lo rompe.
        AND NOT (r.RegistroDiarioCajaDetalle LIKE 'Cobro Crédito%')
        AND DATE(v.VentaFecha) = ?::date ${filtroVentaLocal}
    `;
    const sqlPagos = `
      SELECT p.PagoId, p.PagoFecha, p.PagoMonto, p.PagoTipo, p.PagoUsuarioId,
             u.UsuarioNombre, s.SuscripcionId, pl.PlanNombre,
             c.ClienteNombre, c.ClienteApellido,
             mov.CajaId, mov.CajaDescripcion
      FROM pago p
      JOIN suscripcion s ON s.SuscripcionId = p.SuscripcionId
      LEFT JOIN clientes c ON c.ClienteId = s.ClienteId
      LEFT JOIN plan pl ON pl.PlanId = s.PlanId
      LEFT JOIN usuario u ON u.UsuarioId = p.PagoUsuarioId
      LEFT JOIN LATERAL (
        SELECT r.CajaId, ca.CajaDescripcion
        FROM registrodiariocaja r
        LEFT JOIN caja ca ON ca.CajaId = r.CajaId
        WHERE r.PagoId = p.PagoId AND r.TipoGastoId = 2
        ORDER BY r.RegistroDiarioCajaId
        LIMIT 1
      ) mov ON TRUE
      WHERE p.PagoFecha = ?::date ${filtroPagoLocal}
      ORDER BY p.PagoId DESC
    `;

    const [ventas, items, movs, pagos] = await Promise.all([
      queryAsync(sqlVentas, paramsVenta),
      queryAsync(sqlItems, paramsVenta),
      queryAsync(sqlMovVentas, paramsVenta),
      queryAsync(sqlPagos, paramsPago),
    ]);

    const itemsPorVenta = new Map();
    for (const it of items) {
      if (!itemsPorVenta.has(it.VentaId)) itemsPorVenta.set(it.VentaId, []);
      itemsPorVenta.get(it.VentaId).push(it);
    }
    const movsPorVenta = new Map();
    for (const m of movs) {
      if (!movsPorVenta.has(m.VentaId)) movsPorVenta.set(m.VentaId, []);
      movsPorVenta.get(m.VentaId).push(m);
    }

    res.json({
      fecha,
      localId,
      puedeElegirFecha: alcance.puedeElegirFecha,
      ventas: ventas.map((v) => ({
        ...v,
        Items: itemsPorVenta.get(v.VentaId) || [],
        Movimientos: movsPorVenta.get(v.VentaId) || [],
      })),
      pagos,
    });
  } catch (error) {
    console.error("Error en movimientos del día:", error);
    sendError(res, error, 500);
  }
};
