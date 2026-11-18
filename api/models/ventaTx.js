// Operaciones de venta que corren DENTRO de una transacción abierta por el
// caller. Salieron de venta.controller para que la corrección de caja
// (correccion.controller) cargue o anule ventas con exactamente las mismas
// reglas de stock y caja que el POS.
const { restarUnidades, sumarUnidades } = require("../utils/stockOps");

/**
 * Confirma una venta: cabecera + items + descuento de stock + movimientos de
 * caja + crédito. Replica PVentaConfirmarWS de GeneXus.
 *
 * Montos ya redondeados a entero. Opciones:
 *   - aperturaRef: id de apertura del turno (cerrado) al que se carga la venta.
 *   - sumarCaja:   false para no tocar Caja.CajaMonto (turno cerrado).
 * @returns {{VentaId:number, VentaTipo:string, Total:number, VentaEntrega:number}}
 */
async function confirmarVentaTx(conn, p, { aperturaRef = null, sumarCaja = true } = {}) {
  const {
    ventaFecha,
    AlmacenOrigenId,
    ClienteId,
    CajaId,
    UsuarioId,
    VentaNroFactura = 0,
    VentaTimbrado = 0,
    VentaNroPOS = "0",
    VentaPagoTipo,
    efectivo,
    banco,
    cuentaCliente,
    voucher,
    transferencia,
    Productos,
  } = p;

  // 1. Próximo VentaId, de la secuencia (migración 025). Antes era MAX+1 y,
  // al anular la última venta, la siguiente repetía su número.
  const [seqRows] = await conn.query(
    "SELECT nextval('venta_ventaid_seq') AS id"
  );
  const ultorden = Number(seqRows[0].id);

  // 2. VentaTipo según composición del pago.
  let ventaTipo;
  if (cuentaCliente > 0) ventaTipo = "CR";
  else if (transferencia > 0) ventaTipo = "TR";
  else if (banco > 0) ventaTipo = "PO";
  else ventaTipo = "CO";

  const ventaEntrega = efectivo + banco + voucher + transferencia;
  const total = efectivo + banco + cuentaCliente + voucher + transferencia;

  // 3. Cabecera de venta.
  await conn.query(
    `INSERT INTO venta (
       VentaId, VentaFecha, ClienteId, AlmacenId, VentaTipo, VentaPagoTipo,
       VentaCantidadProductos, VentaUsuario, VentaNroFactura, VentaTimbrado,
       Total, VentaEntrega, VentaNroPOS
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ultorden,
      ventaFecha,
      ClienteId,
      AlmacenOrigenId,
      ventaTipo,
      VentaPagoTipo || "",
      Productos.length,
      UsuarioId,
      VentaNroFactura,
      VentaTimbrado,
      total,
      ventaEntrega,
      VentaNroPOS,
    ]
  );

  // 4. Items + descuento de stock.
  let i = 1;
  for (const p of Productos) {
    const productoId = p.ProductoId;
    const cantidad = Number(p.VentaProductoCantidad);
    const unidad = p.ProductoUnidad === "U" ? "U" : "C";

    // Snapshot del producto para precio promedio + cantidad por caja.
    const [prodRows] = await conn.query(
      `SELECT ProductoPrecioPromedio, ProductoCantidadCaja, ProductoStock, ProductoStockUnitario, ProductoServicio
       FROM producto WHERE ProductoId = ?`,
      [productoId]
    );
    if (!prodRows.length) {
      throw new Error(`Producto ${productoId} no encontrado`);
    }
    const prod = prodRows[0];
    const cantidadCaja = Number(prod.ProductoCantidadCaja);
    // Productos "servicio" (cancha, pelota): no llevan inventario, no se
    // descuenta stock al vender.
    const esServicio = Number(prod.ProductoServicio) === 1;
    const precioPromedioBase = Number(prod.ProductoPrecioPromedio);
    // VentaProductoPrecioPromedio es BIGINT, GeneXus trunca implícitamente al asignar.
    const precioPromedioLinea = Math.round(
      unidad === "U" ? precioPromedioBase / cantidadCaja : precioPromedioBase
    );

    // Totales del item (combo o normal).
    const esCombo = p.Combo === true || p.Combo === "S";
    const precioTotal = esCombo
      ? Number(p.ComboPrecio)
      : Number(p.VentaProductoPrecioTotal);
    // VentaProductoPrecio también es BIGINT.
    const precioUnit = Math.round(precioTotal / cantidad);

    await conn.query(
      `INSERT INTO ventaproducto (
         VentaId, VentaProductoId, ProductoId, VentaProductoCantidad,
         VentaProductoPrecioPromedio, VentaProductoUnitario,
         VentaProductoPrecio, VentaProductoPrecioTotal
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ultorden,
        i,
        productoId,
        cantidad,
        precioPromedioLinea,
        unidad,
        precioUnit,
        precioTotal,
      ]
    );

    // Descuento de stock (se omite para productos servicio).
    if (esServicio) {
      // Sin inventario: no se toca producto ni productoalmacen.
    } else if (unidad === "U") {
      const nProd = restarUnidades(
        prod.ProductoStock,
        prod.ProductoStockUnitario,
        cantidad,
        cantidadCaja
      );
      await conn.query(
        `UPDATE producto SET ProductoStock = ?, ProductoStockUnitario = ?
         WHERE ProductoId = ?`,
        [nProd.stock, nProd.stockUnitario, productoId]
      );

      const [paRows] = await conn.query(
        `SELECT ProductoAlmacenStock, ProductoAlmacenStockUnitario
         FROM productoalmacen WHERE ProductoId = ? AND AlmacenId = ?`,
        [productoId, AlmacenOrigenId]
      );
      // Sin fila en el almacén (producto nunca comprado ahí): se parte de 0
      // y el stock queda negativo, igual que en la tabla producto.
      const nPa = restarUnidades(
        paRows.length ? paRows[0].ProductoAlmacenStock : 0,
        paRows.length ? paRows[0].ProductoAlmacenStockUnitario : 0,
        cantidad,
        cantidadCaja
      );
      if (paRows.length) {
        await conn.query(
          `UPDATE productoalmacen
           SET ProductoAlmacenStock = ?, ProductoAlmacenStockUnitario = ?
           WHERE ProductoId = ? AND AlmacenId = ?`,
          [nPa.stock, nPa.stockUnitario, productoId, AlmacenOrigenId]
        );
      } else {
        await conn.query(
          `INSERT INTO productoalmacen
             (ProductoId, AlmacenId, ProductoAlmacenStock, ProductoAlmacenStockUnitario)
           VALUES (?, ?, ?, ?)`,
          [productoId, AlmacenOrigenId, nPa.stock, nPa.stockUnitario]
        );
      }
    } else {
      await conn.query(
        `UPDATE producto SET ProductoStock = ProductoStock - ? WHERE ProductoId = ?`,
        [cantidad, productoId]
      );
      const [paUpd] = await conn.query(
        `UPDATE productoalmacen
         SET ProductoAlmacenStock = ProductoAlmacenStock - ?
         WHERE ProductoId = ? AND AlmacenId = ?`,
        [cantidad, productoId, AlmacenOrigenId]
      );
      if (paUpd.affectedRows === 0) {
        await conn.query(
          `INSERT INTO productoalmacen
             (ProductoId, AlmacenId, ProductoAlmacenStock, ProductoAlmacenStockUnitario)
           VALUES (?, ?, ?, 0)`,
          [productoId, AlmacenOrigenId, -cantidad]
        );
      }
    }

    i += 1;
  }

  // 5. Cuenta corriente del cliente (crédito).
  if (cuentaCliente > 0) {
    const entregaCredito = efectivo + banco + voucher + transferencia;
    const [vcInsert] = await conn.query(
      `INSERT INTO ventacredito (VentaId, VentaCreditoPagoCant) VALUES (?, ?)`,
      [ultorden, entregaCredito > 0 ? 1 : 0]
    );
    if (entregaCredito > 0) {
      const ventaCreditoId = vcInsert.insertId;
      await conn.query(
        `INSERT INTO ventacreditopago (
           VentaCreditoId, VentaCreditoPagoId, VentaCreditoPagoFecha, VentaCreditoPagoMonto
         ) VALUES (?, ?, ?, ?)`,
        [ventaCreditoId, 1, ventaFecha, entregaCredito]
      );
    }
  }

  // 6. RegistroDiarioCaja por método de pago.
  // Efectivo: TipoGastoGrupoId=3 (cobro crédito) si la venta es a cuenta,
  //           TipoGastoGrupoId=1 (venta contado) si no.
  if (efectivo > 0) {
    const isCredito = cuentaCliente > 0;
    await conn.query(
      `INSERT INTO registrodiariocaja (
         CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
         RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId, VentaId
       ) VALUES (?, ?, 2, ?, ?, ?, ?, ?)`,
      [
        CajaId,
        ventaFecha,
        isCredito ? 3 : 1,
        isCredito ? `Venta Crédito N°: ${ultorden}` : `Venta N°: ${ultorden}`,
        efectivo,
        UsuarioId,
        ultorden,
      ]
    );
  }
  if (banco > 0) {
    await conn.query(
      `INSERT INTO registrodiariocaja (
         CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
         RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId, VentaId
       ) VALUES (?, ?, 2, 4, ?, ?, ?, ?)`,
      [CajaId, ventaFecha, `Venta POS N°: ${ultorden}`, banco, UsuarioId, ultorden]
    );
  }
  if (voucher > 0) {
    await conn.query(
      `INSERT INTO registrodiariocaja (
         CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
         RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId, VentaId
       ) VALUES (?, ?, 2, 5, ?, ?, ?, ?)`,
      [CajaId, ventaFecha, `Venta Voucher N°: ${ultorden}`, voucher, UsuarioId, ultorden]
    );
  }
  if (transferencia > 0) {
    await conn.query(
      `INSERT INTO registrodiariocaja (
         CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
         RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId, VentaId
       ) VALUES (?, ?, 2, 6, ?, ?, ?, ?)`,
      [
        CajaId,
        ventaFecha,
        `Venta Transferencia N°: ${ultorden}`,
        transferencia,
        UsuarioId,
        ultorden,
      ]
    );
  }

  // 7. Marca de turno: una venta cargada por corrección en un turno cerrado
  // pertenece a ese turno aunque su id quede después del cierre
  // (utils/turnoCaja.js).
  if (aperturaRef) {
    await conn.query(
      `UPDATE registrodiariocaja SET AperturaRef = ? WHERE VentaId = ?`,
      [aperturaRef, ultorden]
    );
  }

  // 8. Solo el efectivo se acumula en la caja física. En un turno cerrado no
  // se toca: el cajón ya se rindió y CajaMonto es el del turno de hoy.
  if (sumarCaja && efectivo > 0) {
    await conn.query(
      `UPDATE caja SET CajaMonto = CajaMonto + ? WHERE CajaId = ?`,
      [efectivo, CajaId]
    );
  }

  return {
    VentaId: ultorden,
    VentaTipo: ventaTipo,
    Total: total,
    VentaEntrega: ventaEntrega,
  };
}

/**
 * Devuelve al stock (general y del almacén) los productos de una venta.
 * Los productos servicio no llevan inventario y se saltean.
 */
async function restituirStockVentaTx(conn, ventaId, almacenId) {
  const [vpRows] = await conn.query(
    `SELECT ProductoId, VentaProductoCantidad, VentaProductoUnitario
     FROM ventaproducto WHERE VentaId = ?`,
    [ventaId]
  );
  for (const vp of vpRows) {
    const productoId = vp.ProductoId;
    const cantidad = Number(vp.VentaProductoCantidad);
    const unidad = vp.VentaProductoUnitario === "U" ? "U" : "C";

    const [prodRows] = await conn.query(
      `SELECT ProductoCantidadCaja, ProductoStock, ProductoStockUnitario, ProductoServicio
       FROM producto WHERE ProductoId = ?`,
      [productoId]
    );
    if (!prodRows.length) continue;
    const prod = prodRows[0];
    const cantidadCaja = Number(prod.ProductoCantidadCaja);

    // Productos servicio no llevan inventario: no se repone stock.
    if (Number(prod.ProductoServicio) === 1) {
      continue;
    }

    if (unidad === "U") {
      const nProd = sumarUnidades(
        prod.ProductoStock,
        prod.ProductoStockUnitario,
        cantidad,
        cantidadCaja
      );
      await conn.query(
        `UPDATE producto SET ProductoStock = ?, ProductoStockUnitario = ?
         WHERE ProductoId = ?`,
        [nProd.stock, nProd.stockUnitario, productoId]
      );

      const [paRows] = await conn.query(
        `SELECT ProductoAlmacenStock, ProductoAlmacenStockUnitario
         FROM productoalmacen WHERE ProductoId = ? AND AlmacenId = ?`,
        [productoId, almacenId]
      );
      if (paRows.length) {
        const nPa = sumarUnidades(
          paRows[0].ProductoAlmacenStock,
          paRows[0].ProductoAlmacenStockUnitario,
          cantidad,
          cantidadCaja
        );
        await conn.query(
          `UPDATE productoalmacen
           SET ProductoAlmacenStock = ?, ProductoAlmacenStockUnitario = ?
           WHERE ProductoId = ? AND AlmacenId = ?`,
          [nPa.stock, nPa.stockUnitario, productoId, almacenId]
        );
      }
    } else {
      await conn.query(
        `UPDATE producto SET ProductoStock = ProductoStock + ? WHERE ProductoId = ?`,
        [cantidad, productoId]
      );
      await conn.query(
        `UPDATE productoalmacen
         SET ProductoAlmacenStock = ProductoAlmacenStock + ?
         WHERE ProductoId = ? AND AlmacenId = ?`,
        [cantidad, productoId, almacenId]
      );
    }
  }
}

module.exports = { confirmarVentaTx, restituirStockVentaTx };
