// Reglas puras de la corrección de caja (sin base de datos), para poder
// probarlas. El flujo transaccional está en models/correccionCaja.model.js.
//
// Medios de cobro y cómo se escriben en `registrodiariocaja`. Los textos del
// detalle NO son decorativos: el reporte de cierre, el "Resumen por local" y
// la anulación de ventas los usan para saber el origen del movimiento
// (client/src/utils/cajaOrigen.ts, venta.controller). Por eso una corrección
// reescribe el detalle con el mismo formato que usa el flujo original.
const { getLabel } = require("../constants/pagoTipos");

const MEDIOS = ["EFECTIVO", "POS", "VOUCHER", "TRANSFERENCIA"];

const MEDIO_A_PAGOTIPO = {
  EFECTIVO: "CO",
  POS: "PO",
  VOUCHER: "VO",
  TRANSFERENCIA: "TR",
};

// Grupos que ingresan billetes al cajón: venta contado (1) y venta crédito /
// cobro de crédito en efectivo (3). Es el criterio de venta.controller y
// pago.controller para sumar a Caja.CajaMonto.
const GRUPOS_EFECTIVO = new Set([1, 3]);

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 250;

function esGrupoEfectivo(grupoId) {
  return GRUPOS_EFECTIVO.has(Number(grupoId));
}

function medioDeGrupo(grupoId) {
  switch (Number(grupoId)) {
    case 1:
    case 3:
      return "EFECTIVO";
    case 4:
      return "POS";
    case 5:
      return "VOUCHER";
    case 6:
      return "TRANSFERENCIA";
    default:
      return null;
  }
}

/**
 * Qué es un movimiento de ingreso: venta de cantina, cobro de crédito de una
 * venta, o pago de suscripción. null = no se corrige desde esta herramienta
 * (cancha, gastos, apertura/cierre…).
 */
function clasificarMovimiento(reg) {
  if (Number(reg.TipoGastoId) !== 2 || Number(reg.TipoGastoGrupoId) === 2) {
    return null;
  }
  const det = String(reg.RegistroDiarioCajaDetalle || "");
  if (reg.PagoId != null) return "PAGO";
  if (reg.VentaId != null) {
    return det.startsWith("Cobro Crédito") ? "COBRO_CREDITO" : "VENTA";
  }
  return null;
}

/**
 * Grupo y detalle que debe tener el movimiento con el medio nuevo.
 * @param {"VENTA"|"COBRO_CREDITO"|"PAGO"} tipo
 * @param {string} medio  uno de MEDIOS
 * @param {{ventaId?:number, ventaTipo?:string, suscripcionId?:number}} ctx
 * @returns {{grupoId:number, detalle:string, pagoTipo?:string} | {error:string}}
 */
function destinoMedio(tipo, medio, ctx = {}) {
  if (!MEDIOS.includes(medio)) return { error: `Medio inválido: ${medio}` };

  if (tipo === "VENTA") {
    const id = ctx.ventaId;
    switch (medio) {
      case "EFECTIVO":
        // Mismo criterio que confirmar: el efectivo de una venta a cuenta
        // va al grupo 3 con su propio texto.
        return ctx.ventaTipo === "CR"
          ? { grupoId: 3, detalle: `Venta Crédito N°: ${id}` }
          : { grupoId: 1, detalle: `Venta N°: ${id}` };
      case "POS":
        return { grupoId: 4, detalle: `Venta POS N°: ${id}` };
      case "VOUCHER":
        return { grupoId: 5, detalle: `Venta Voucher N°: ${id}` };
      case "TRANSFERENCIA":
        return { grupoId: 6, detalle: `Venta Transferencia N°: ${id}` };
    }
  }

  if (tipo === "COBRO_CREDITO") {
    const id = ctx.ventaId;
    switch (medio) {
      case "EFECTIVO":
        return { grupoId: 3, detalle: `Cobro Crédito Efectivo N°: ${id}` };
      case "POS":
        return { grupoId: 4, detalle: `Cobro Crédito POS N°: ${id}` };
      case "TRANSFERENCIA":
        return { grupoId: 6, detalle: `Cobro Crédito Transfer N°: ${id}` };
      default:
        return { error: "El cobro de crédito no admite voucher" };
    }
  }

  if (tipo === "PAGO") {
    const pagoTipo = MEDIO_A_PAGOTIPO[medio];
    const grupoId = { CO: 1, PO: 4, VO: 5, TR: 6 }[pagoTipo];
    return {
      grupoId,
      pagoTipo,
      // Mismo formato que pago.controller.
      detalle: `Pago suscripción #${ctx.suscripcionId} - ${getLabel(pagoTipo)}`,
    };
  }

  return { error: "Este movimiento no se puede corregir desde acá" };
}

/**
 * VentaTipo según los medios con que quedó cobrada. Misma prioridad que
 * venta.controller.confirmar: crédito > transferencia > POS > contado. Una
 * venta a cuenta (CR) sigue siendo CR: su saldo no depende del medio.
 */
function recalcularVentaTipo(ventaTipoActual, grupos) {
  if (ventaTipoActual === "CR") return "CR";
  const gs = grupos.map(Number);
  if (gs.includes(6)) return "TR";
  if (gs.includes(4)) return "PO";
  return "CO";
}

/**
 * Cuánto cambia el efectivo del cajón al pasar un movimiento de un grupo a
 * otro (+ entra efectivo, − sale). Sólo se aplica si el turno está abierto.
 */
function deltaEfectivo(monto, grupoViejo, grupoNuevo) {
  const m = Number(monto) || 0;
  return (esGrupoEfectivo(grupoNuevo) ? m : 0) - (esGrupoEfectivo(grupoViejo) ? m : 0);
}

function validarMotivo(motivo) {
  const m = String(motivo ?? "").trim();
  if (m.length < MOTIVO_MIN) {
    return { error: `Indicá el motivo de la corrección (mínimo ${MOTIVO_MIN} caracteres)` };
  }
  if (m.length > MOTIVO_MAX) {
    return { error: `El motivo no puede superar ${MOTIVO_MAX} caracteres` };
  }
  return { motivo: m };
}

/**
 * ¿El turno cerrado todavía se puede corregir? `dias` = plazo configurado
 * (CORRECCION_CAJA_DIAS). Se cuenta en días calendario locales desde el día
 * del cierre: con 7, un cierre del lunes se corrige hasta el lunes siguiente.
 */
function dentroDePlazo(fechaCierre, hoyISO, dias) {
  if (!fechaCierre) return true;
  const d = fechaCierre instanceof Date ? fechaCierre : new Date(fechaCierre);
  if (isNaN(d.getTime())) return false;
  const cierre = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const [y, m, dd] = String(hoyISO).split("-").map(Number);
  const hoy = new Date(y, m - 1, dd);
  const diff = Math.round((hoy - cierre) / 86400000);
  return diff <= Number(dias);
}

/**
 * Quién puede corregir qué.
 *   - Turno cerrado: admin o CORRECCIONCAJA "eliminar" (supervisor), y
 *     dentro del plazo.
 *   - Turno abierto: el supervisor, o el dueño del turno con
 *     CORRECCIONCAJA "editar" (corrige su propia caja en el momento).
 * @returns {{ok:true} | {ok:false, status:number, message:string}}
 */
function evaluarPermisoCorreccion({
  turno,
  usuarioId,
  esSupervisor,
  puedeEditarPropio,
  hoyISO,
  plazoDias,
}) {
  if (!turno || turno.fueraDeTurno || turno.aperturaId == null) {
    return {
      ok: false,
      status: 409,
      message:
        "El movimiento no pertenece a ningún turno (se cargó con la caja cerrada). Corregilo desde el Registro Diario de Caja.",
    };
  }
  if (turno.abierto) {
    if (esSupervisor) return { ok: true };
    if (puedeEditarPropio && String(turno.usuarioId) === String(usuarioId)) {
      return { ok: true };
    }
    return {
      ok: false,
      status: 403,
      message: "Sólo podés corregir movimientos de tu propio turno abierto",
    };
  }
  if (!esSupervisor) {
    return {
      ok: false,
      status: 403,
      message: "Corregir un turno cerrado requiere permiso de supervisor",
    };
  }
  if (!dentroDePlazo(turno.cierreFecha, hoyISO, plazoDias)) {
    return {
      ok: false,
      status: 409,
      message: `El turno se cerró hace más de ${plazoDias} días y ya no se puede corregir`,
    };
  }
  return { ok: true };
}

module.exports = {
  MEDIOS,
  esGrupoEfectivo,
  medioDeGrupo,
  clasificarMovimiento,
  destinoMedio,
  recalcularVentaTipo,
  deltaEfectivo,
  validarMotivo,
  dentroDePlazo,
  evaluarPermisoCorreccion,
};
