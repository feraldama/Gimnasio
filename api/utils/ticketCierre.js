// Reimpresión del ticket de cierre: cuánto cambió el "efectivo esperado" de un
// turno por las correcciones hechas DESPUÉS de cerrarlo, para poder mostrar en
// el ticket el sobrante/faltante que tuvo esa noche (el que imprimió el cajero).
//
// Regla de efectivo = la del ticket (client/src/utils/cajaOrigen.ts):
//   ingreso (TipoGastoId 2) de cualquier grupo salvo 2/4/5/6 → efectivo (+)
//   egreso  (TipoGastoId 1) de cualquier grupo salvo 2       → efectivo (−)
//
// Las correcciones hechas con el turno ABIERTO (CierreId null en
// correccioncaja) ya estaban aplicadas cuando el cajero cerró: no cuentan.
//
// Devuelve `ajuste` = esperado actual − esperado original. Entonces:
//   diferencia original = diferencia actual − ajuste
const { perteneceAlTurno } = require("./turnoCaja");

function efectoEnEsperado(tipoGastoId, grupoId, monto) {
  const g = Number(grupoId);
  const m = Number(monto) || 0;
  if (g === 2) return 0;
  if (Number(tipoGastoId) === 2) return [4, 5, 6].includes(g) ? 0 : m;
  if (Number(tipoGastoId) === 1) return -m;
  return 0;
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

/**
 * @param {object[]} correcciones  filas de correccioncaja del turno (AperturaId)
 * @param {object[]} registros     movimientos ACTUALES del turno
 * @param {{aperturaId:number, cierreId:number}} turno
 * @returns {{ajuste:number, cantidad:number}}
 */
function ajustePorCorreccionesPosteriores(correcciones, registros, turno) {
  const posteriores = (correcciones || []).filter((c) => c.CierreId != null);

  // Movimientos que se cargaron DESPUÉS del cierre (AperturaRef): no estaban
  // en el turno original, así que lo que les pase después no cambia el
  // esperado original. Se buscan en los actuales y en los anulados.
  const cargadoDespues = new Map();
  for (const r of registros || []) {
    cargadoDespues.set(Number(r.RegistroDiarioCajaId), r.AperturaRef != null);
  }
  for (const c of posteriores) {
    const antes = parseJson(c.CorreccionCajaAntes);
    for (const m of antes?.movimientos || []) {
      cargadoDespues.set(Number(m.RegistroDiarioCajaId), m.AperturaRef != null);
    }
  }

  let ajuste = 0;
  for (const c of posteriores) {
    const antes = parseJson(c.CorreccionCajaAntes);
    const despues = parseJson(c.CorreccionCajaDespues);
    const accion = c.CorreccionCajaAccion;

    if (accion === "METODO" && antes && despues) {
      if (cargadoDespues.get(Number(antes.RegistroDiarioCajaId))) continue;
      const monto = antes.RegistroDiarioCajaMonto;
      ajuste +=
        efectoEnEsperado(2, despues.TipoGastoGrupoId, monto) -
        efectoEnEsperado(2, antes.TipoGastoGrupoId, monto);
    } else if (accion === "ANULAR" && antes) {
      for (const m of antes.movimientos || []) {
        if (m.AperturaRef != null) continue;
        if (!perteneceAlTurno(m, turno.aperturaId, turno.cierreId)) continue;
        ajuste -= efectoEnEsperado(m.TipoGastoId, m.TipoGastoGrupoId, m.RegistroDiarioCajaMonto);
      }
    } else if (c.CorreccionCajaEntidad === "REGISTRO" && antes) {
      // Editado/borrado desde Registro Diario Caja.
      if (antes.AperturaRef != null) continue;
      const efectoAntes = efectoEnEsperado(
        antes.TipoGastoId,
        antes.TipoGastoGrupoId,
        antes.RegistroDiarioCajaMonto
      );
      if (accion === "ELIMINAR") ajuste -= efectoAntes;
      else if (accion === "EDITAR" && despues) {
        ajuste +=
          efectoEnEsperado(despues.TipoGastoId, despues.TipoGastoGrupoId, despues.RegistroDiarioCajaMonto) -
          efectoAntes;
      }
    } else if (accion === "CARGAR" && c.CorreccionCajaEntidad === "REGISTRO") {
      // Egreso cargado en el turno cerrado desde Corrección de caja. Si
      // después se editó o borró, vale como está ahora (esas correcciones se
      // saltean arriba por tener AperturaRef).
      const id = Number(c.CorreccionCajaEntidadId);
      const r = (registros || []).find(
        (x) => Number(x.RegistroDiarioCajaId) === id && x.AperturaRef != null
      );
      if (r) ajuste += efectoEnEsperado(r.TipoGastoId, r.TipoGastoGrupoId, r.RegistroDiarioCajaMonto);
    } else if (accion === "CARGAR") {
      const ventaId = Number(c.CorreccionCajaEntidadId);
      for (const r of registros || []) {
        if (r.AperturaRef == null || Number(r.VentaId) !== ventaId) continue;
        ajuste += efectoEnEsperado(r.TipoGastoId, r.TipoGastoGrupoId, r.RegistroDiarioCajaMonto);
      }
    }
  }
  return { ajuste, cantidad: posteriores.length };
}

/**
 * Efectivo esperado del turno: apertura + ingresos en efectivo − egresos.
 * `registros` puede incluir la apertura y el cierre (grupo 2, no cuentan).
 */
function esperadoDelTurno(registros, aperturaMonto) {
  let esperado = Number(aperturaMonto) || 0;
  for (const r of registros || []) {
    esperado += efectoEnEsperado(r.TipoGastoId, r.TipoGastoGrupoId, r.RegistroDiarioCajaMonto);
  }
  return esperado;
}

/**
 * Sobrante/faltante que tuvo el turno al cerrarse (> 0 faltante).
 * Si el cierre lo guardó (migración 026) se usa ése; si no (cierres
 * anteriores), se reconstruye deshaciendo las correcciones posteriores.
 */
function diferenciaAlCerrar({ cierre, apertura, registros, correcciones, turno }) {
  if (cierre?.DiferenciaCierre != null) return Number(cierre.DiferenciaCierre);
  // Si después se corrigió el monto de la apertura o del cierre desde
  // Registro Diario Caja, vale el que tenía antes de la primera corrección.
  const montoOriginal = (fila) => {
    if (!fila) return 0;
    const primera = (correcciones || []).find(
      (c) =>
        c.CierreId != null &&
        c.CorreccionCajaEntidad === "REGISTRO" &&
        c.CorreccionCajaAccion === "EDITAR" &&
        Number(c.CorreccionCajaEntidadId) === Number(fila.RegistroDiarioCajaId)
    );
    const antes = primera ? parseJson(primera.CorreccionCajaAntes) : null;
    return Number(antes ? antes.RegistroDiarioCajaMonto : fila.RegistroDiarioCajaMonto) || 0;
  };
  const esperadoActual = esperadoDelTurno(registros, 0);
  const { ajuste } = ajustePorCorreccionesPosteriores(correcciones, registros, turno);
  return montoOriginal(apertura) + esperadoActual - ajuste - montoOriginal(cierre);
}

module.exports = {
  ajustePorCorreccionesPosteriores,
  efectoEnEsperado,
  esperadoDelTurno,
  diferenciaAlCerrar,
};
