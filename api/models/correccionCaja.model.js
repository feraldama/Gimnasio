// Corrección de ventas y cobros sobre su turno de caja original.
//
// PRINCIPIO: la corrección se aplica sobre los mismos registros que se
// cargaron mal (mismo RegistroDiarioCajaId), así el movimiento sigue dentro de
// su turno y el cierre de ESE turno queda cuadrado. Nunca se agrega un asiento
// compensatorio en la caja de hoy: eso movía la diferencia al cierre de hoy,
// que es justamente el problema que reportó el cliente.
//
// CAJA FÍSICA: Caja.CajaMonto es un único saldo que vuelve a 0 en cada cierre,
// así que pertenece al turno abierto. Si el turno corregido está cerrado, el
// cajón ya se rindió y no se toca. Si está abierto, se ajusta el efectivo.
//
// Todas las funciones corren dentro de una transacción abierta por el caller
// (`conn`) y dejan rastro en `correccioncaja`. Los errores de negocio se
// lanzan con `.status` para que el controller los devuelva tal cual.
const {
  clasificarMovimiento,
  destinoMedio,
  recalcularVentaTipo,
  deltaEfectivo,
  esGrupoEfectivo,
  medioDeGrupo,
} = require("../utils/correccionCaja");
const { turnoDeMovimiento, turnoDeApertura } = require("../utils/turnoCaja");
const { confirmarVentaTx, restituirStockVentaTx } = require("./ventaTx");

function errorNegocio(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Aplica la decisión de `autorizar(turno)`; sin callback no se restringe. */
function exigir(autorizar, turno) {
  if (!autorizar) return;
  const r = autorizar(turno);
  if (!r.ok) throw errorNegocio(r.status, r.message);
}

async function registrarCorreccion(conn, c) {
  const [r] = await conn.query(
    `INSERT INTO correccioncaja (
       UsuarioId, CorreccionCajaEntidad, CorreccionCajaEntidadId,
       CorreccionCajaAccion, AperturaId, CierreId, CorreccionCajaMotivo,
       CorreccionCajaAntes, CorreccionCajaDespues
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)`,
    [
      c.usuarioId,
      c.entidad,
      c.entidadId,
      c.accion,
      c.turno?.aperturaId ?? null,
      c.turno?.cierreId ?? null,
      c.motivo,
      JSON.stringify(c.antes ?? null),
      JSON.stringify(c.despues ?? null),
    ]
  );
  return r.insertId;
}

async function ajustarCajon(conn, turno, cajaId, delta) {
  if (!turno?.abierto || !delta) return;
  await conn.query(
    "UPDATE caja SET CajaMonto = CajaMonto + ? WHERE CajaId = ?",
    [delta, cajaId]
  );
}

/**
 * Cambia el medio de cobro de un movimiento (venta, cobro de crédito o pago
 * de suscripción). Caso típico: cobro cargado como transferencia que era
 * efectivo.
 */
async function cambiarMedioTx(conn, { registroId, medio, motivo, usuarioId, autorizar }) {
  const [regs] = await conn.query(
    "SELECT * FROM registrodiariocaja WHERE RegistroDiarioCajaId = ? FOR UPDATE",
    [registroId]
  );
  const reg = regs[0];
  if (!reg) throw errorNegocio(404, "Movimiento no encontrado");

  const tipo = clasificarMovimiento(reg);
  if (!tipo) {
    throw errorNegocio(
      409,
      "Este movimiento no está vinculado a una venta o un cobro de gimnasio y no se puede corregir desde acá"
    );
  }

  const turno = await turnoDeMovimiento(conn, reg);
  exigir(autorizar, turno);

  const grupoViejo = Number(reg.TipoGastoGrupoId);
  let destino;
  let antes;
  let entidad;
  let entidadId;

  if (tipo === "PAGO") {
    const [ps] = await conn.query("SELECT * FROM pago WHERE PagoId = ? FOR UPDATE", [reg.PagoId]);
    const pago = ps[0];
    if (!pago) throw errorNegocio(404, "El pago de este movimiento ya no existe");
    destino = destinoMedio("PAGO", medio, { suscripcionId: pago.SuscripcionId });
    if (destino.error) throw errorNegocio(400, destino.error);
    if (destino.grupoId === grupoViejo) throw errorNegocio(409, "El cobro ya tiene ese medio");
    antes = { PagoTipo: pago.PagoTipo };
    entidad = "PAGO";
    entidadId = pago.PagoId;
    await conn.query("UPDATE pago SET PagoTipo = ? WHERE PagoId = ?", [
      destino.pagoTipo,
      pago.PagoId,
    ]);
  } else {
    const [vs] = await conn.query("SELECT * FROM venta WHERE VentaId = ? FOR UPDATE", [reg.VentaId]);
    const venta = vs[0];
    if (!venta) throw errorNegocio(404, "La venta de este movimiento ya no existe");
    destino = destinoMedio(tipo, medio, { ventaId: venta.VentaId, ventaTipo: venta.VentaTipo });
    if (destino.error) throw errorNegocio(400, destino.error);
    if (medioDeGrupo(destino.grupoId) === medioDeGrupo(grupoViejo)) {
      throw errorNegocio(409, "El movimiento ya tiene ese medio");
    }
    antes = { VentaTipo: venta.VentaTipo };
    entidad = "VENTA";
    entidadId = venta.VentaId;
  }

  antes = {
    ...antes,
    RegistroDiarioCajaId: reg.RegistroDiarioCajaId,
    TipoGastoGrupoId: grupoViejo,
    RegistroDiarioCajaDetalle: reg.RegistroDiarioCajaDetalle,
    RegistroDiarioCajaMonto: Number(reg.RegistroDiarioCajaMonto),
  };

  await conn.query(
    `UPDATE registrodiariocaja
     SET TipoGastoGrupoId = ?, RegistroDiarioCajaDetalle = ?
     WHERE RegistroDiarioCajaId = ?`,
    [destino.grupoId, destino.detalle, reg.RegistroDiarioCajaId]
  );

  const despues = {
    RegistroDiarioCajaId: reg.RegistroDiarioCajaId,
    TipoGastoGrupoId: destino.grupoId,
    RegistroDiarioCajaDetalle: destino.detalle,
  };
  if (destino.pagoTipo) despues.PagoTipo = destino.pagoTipo;

  if (tipo === "VENTA") {
    // El tipo de la venta se deduce de con qué se cobró (sin los cobros de
    // crédito posteriores, que no cambian el tipo de la venta original).
    const [movs] = await conn.query(
      `SELECT TipoGastoGrupoId, RegistroDiarioCajaDetalle FROM registrodiariocaja
       WHERE VentaId = ? AND TipoGastoId = 2`,
      [entidadId]
    );
    const grupos = movs
      .filter((m) => !String(m.RegistroDiarioCajaDetalle || "").startsWith("Cobro Crédito"))
      .map((m) => m.TipoGastoGrupoId);
    const nuevoTipo = recalcularVentaTipo(antes.VentaTipo, grupos);
    if (nuevoTipo !== antes.VentaTipo) {
      await conn.query("UPDATE venta SET VentaTipo = ? WHERE VentaId = ?", [nuevoTipo, entidadId]);
    }
    despues.VentaTipo = nuevoTipo;
  }

  const delta = deltaEfectivo(reg.RegistroDiarioCajaMonto, grupoViejo, destino.grupoId);
  await ajustarCajon(conn, turno, reg.CajaId, delta);
  despues.ajusteCajon = turno.abierto ? delta : 0;

  const correccionId = await registrarCorreccion(conn, {
    usuarioId,
    entidad,
    entidadId,
    accion: "METODO",
    turno,
    motivo,
    antes,
    despues,
  });

  return { correccionId, turno, antes, despues };
}

/**
 * Anula una venta: borra sus movimientos de caja de los turnos donde están,
 * devuelve el stock y borra la venta. El efectivo sólo se descuenta del cajón
 * si el turno de ese movimiento sigue abierto.
 *
 * `autorizar(turno)` se evalúa con el turno de cada movimiento; para una venta
 * sin movimientos de caja se evalúa con `null`.
 */
async function anularVentaTx(conn, { ventaId, motivo, usuarioId, autorizar }) {
  const [vs] = await conn.query("SELECT * FROM venta WHERE VentaId = ? FOR UPDATE", [ventaId]);
  const venta = vs[0];
  if (!venta) throw errorNegocio(404, "Venta no encontrada");

  // Por VentaId (migración 023) y, por las dudas, por el texto del detalle
  // para movimientos viejos que no se pudieron vincular.
  const detalles = [
    `Venta N°: ${ventaId}`,
    `Venta POS N°: ${ventaId}`,
    `Venta Crédito N°: ${ventaId}`,
    `Venta Transferencia N°: ${ventaId}`,
    `Venta Voucher N°: ${ventaId}`,
    `Cobro Crédito Efectivo N°: ${ventaId}`,
    `Cobro Crédito POS N°: ${ventaId}`,
    `Cobro Crédito Transfer N°: ${ventaId}`,
  ];
  const [movs] = await conn.query(
    `SELECT * FROM registrodiariocaja
     WHERE VentaId = ? OR RegistroDiarioCajaDetalle IN (?, ?, ?, ?, ?, ?, ?, ?)
     ORDER BY RegistroDiarioCajaId
     FOR UPDATE`,
    [ventaId, ...detalles]
  );

  const turnos = [];
  for (const m of movs) {
    const t = await turnoDeMovimiento(conn, m);
    exigir(autorizar, t.fueraDeTurno ? null : t);
    turnos.push(t);
  }
  if (!movs.length) exigir(autorizar, null);

  const [items] = await conn.query(
    "SELECT * FROM ventaproducto WHERE VentaId = ? ORDER BY VentaProductoId",
    [ventaId]
  );

  // Efectivo a retirar del cajón, sólo de movimientos en turnos abiertos.
  for (let i = 0; i < movs.length; i++) {
    const m = movs[i];
    if (esGrupoEfectivo(m.TipoGastoGrupoId)) {
      await ajustarCajon(conn, turnos[i], m.CajaId, -Number(m.RegistroDiarioCajaMonto));
    }
  }

  if (movs.length) {
    await conn.query(
      `DELETE FROM registrodiariocaja WHERE RegistroDiarioCajaId IN (${movs
        .map(() => "?")
        .join(", ")})`,
      movs.map((m) => m.RegistroDiarioCajaId)
    );
  }

  await restituirStockVentaTx(conn, ventaId, venta.AlmacenId);

  await conn.query(
    `DELETE FROM ventacreditopago
     WHERE VentaCreditoId IN (SELECT VentaCreditoId FROM ventacredito WHERE VentaId = ?)`,
    [ventaId]
  );
  await conn.query("DELETE FROM ventacredito WHERE VentaId = ?", [ventaId]);
  await conn.query("DELETE FROM ventaproducto WHERE VentaId = ?", [ventaId]);
  await conn.query("DELETE FROM venta WHERE VentaId = ?", [ventaId]);

  // Una venta tiene todos sus movimientos de venta en un turno; se registra
  // ése (el primero). Los cobros de crédito posteriores quedan en `antes`.
  const turno = turnos.find((t) => !t.fueraDeTurno) || null;
  const correccionId = await registrarCorreccion(conn, {
    usuarioId,
    entidad: "VENTA",
    entidadId: ventaId,
    accion: "ANULAR",
    turno,
    motivo,
    antes: { venta, items, movimientos: movs },
    despues: {
      ajusteCajon: movs.reduce(
        (s, m, i) =>
          s + (turnos[i].abierto && esGrupoEfectivo(m.TipoGastoGrupoId) ? -Number(m.RegistroDiarioCajaMonto) : 0),
        0
      ),
    },
  });

  return { correccionId, turno, movimientos: movs.length };
}

/**
 * Anula un pago de suscripción vinculado a su movimiento de caja (PagoId).
 * Devuelve `null` si el pago no tiene movimiento vinculado: el caller decide
 * qué hacer (pago.controller mantiene el comportamiento anterior).
 */
async function anularPagoVinculadoTx(conn, { pagoId, motivo, usuarioId, autorizar }) {
  const [ps] = await conn.query("SELECT * FROM pago WHERE PagoId = ? FOR UPDATE", [pagoId]);
  const pago = ps[0];
  if (!pago) throw errorNegocio(404, "Pago no encontrado");

  const [movs] = await conn.query(
    `SELECT * FROM registrodiariocaja
     WHERE PagoId = ? AND TipoGastoId = 2
     ORDER BY RegistroDiarioCajaId FOR UPDATE`,
    [pagoId]
  );
  if (!movs.length) return null;

  const turnos = [];
  for (const m of movs) {
    const t = await turnoDeMovimiento(conn, m);
    exigir(autorizar, t.fueraDeTurno ? null : t);
    turnos.push(t);
  }

  let ajuste = 0;
  for (let i = 0; i < movs.length; i++) {
    const m = movs[i];
    if (esGrupoEfectivo(m.TipoGastoGrupoId) && turnos[i].abierto) {
      ajuste -= Number(m.RegistroDiarioCajaMonto);
      await ajustarCajon(conn, turnos[i], m.CajaId, -Number(m.RegistroDiarioCajaMonto));
    }
  }

  await conn.query(
    `DELETE FROM registrodiariocaja WHERE RegistroDiarioCajaId IN (${movs
      .map(() => "?")
      .join(", ")})`,
    movs.map((m) => m.RegistroDiarioCajaId)
  );
  await conn.query("DELETE FROM pago WHERE PagoId = ?", [pagoId]);

  const turno = turnos.find((t) => !t.fueraDeTurno) || null;
  const correccionId = await registrarCorreccion(conn, {
    usuarioId,
    entidad: "PAGO",
    entidadId: pagoId,
    accion: "ANULAR",
    turno,
    motivo,
    antes: { pago, movimientos: movs },
    despues: { ajusteCajon: ajuste },
  });
  return { correccionId, turno };
}

/** Fecha local "YYYY-MM-DD HH:MM:SS" (las columnas son TIMESTAMP sin zona). */
function fechaLocalSQL(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(
    x.getHours()
  )}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
}

/**
 * Carga en un turno YA CERRADO una venta que se cobró pero nunca se registró.
 * Queda con la caja y el usuario de ese turno, AperturaRef = su apertura y
 * fecha = la del cierre, y no toca el cajón (ya se rindió). El stock sí se
 * descuenta: es un saldo actual, no algo que se lleve por día.
 */
async function cargarVentaEnTurnoTx(
  conn,
  { aperturaId, motivo, usuarioId, autorizar, venta }
) {
  const turno = await turnoDeApertura(conn, aperturaId);
  if (!turno) throw errorNegocio(404, "Turno no encontrado");
  if (turno.abierto) {
    throw errorNegocio(
      409,
      "El turno sigue abierto: cargá la venta desde el POS como siempre"
    );
  }
  exigir(autorizar, turno);

  const almacenId = Number(venta.AlmacenOrigenId) || Number(turno.apertura.LocalId) || 0;
  if (!almacenId) {
    throw errorNegocio(400, "La caja del turno no tiene local: indicá el almacén");
  }

  const r = await confirmarVentaTx(
    conn,
    {
      ventaFecha: fechaLocalSQL(turno.cierreFecha),
      AlmacenOrigenId: almacenId,
      ClienteId: venta.ClienteId || 1,
      CajaId: turno.cajaId,
      UsuarioId: turno.usuarioId,
      VentaPagoTipo: "",
      efectivo: venta.efectivo,
      banco: venta.banco,
      cuentaCliente: venta.cuentaCliente,
      voucher: venta.voucher,
      transferencia: venta.transferencia,
      Productos: venta.Productos,
    },
    { aperturaRef: turno.aperturaId, sumarCaja: false }
  );

  const correccionId = await registrarCorreccion(conn, {
    usuarioId,
    entidad: "VENTA",
    entidadId: r.VentaId,
    accion: "CARGAR",
    turno,
    motivo,
    antes: null,
    despues: { ...r, Productos: venta.Productos },
  });
  return { correccionId, turno, venta: r };
}

module.exports = {
  cambiarMedioTx,
  anularVentaTx,
  anularPagoVinculadoTx,
  cargarVentaEnTurnoTx,
  errorNegocio,
};
