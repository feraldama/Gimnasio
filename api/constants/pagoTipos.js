// Catálogo central de tipos de pago de suscripción.
// Si en algún momento se quieren mover a BD, esta constante puede ser
// reemplazada por una consulta a tipogastogrupo cacheada.
const PAGO_TIPOS = {
  CO: { codigo: "CO", label: "Contado", tipoGastoGrupoId: 1 },
  CR: { codigo: "CR", label: "Crédito", tipoGastoGrupoId: 3 },
  PO: { codigo: "PO", label: "POS", tipoGastoGrupoId: 4 },
  VO: { codigo: "VO", label: "Voucher", tipoGastoGrupoId: 5 },
  TR: { codigo: "TR", label: "Transferencia", tipoGastoGrupoId: 6 },
};

// Métodos que efectivamente ingresan plata al cajón físico. Sólo estos suman
// a Caja.CajaMonto cuando se cobra. POS, voucher, transferencia, crédito
// quedan registrados en planilla pero no mueven el cajón.
//
// Compartido entre pago.controller, canchaReserva.controller (cobrar reserva)
// y canchaCredito.controller (cobrar saldo). Si en el futuro se decide que
// otro método también ingresa efectivo (p.ej. una "vuelta de POS"), se agrega
// acá y todos los flujos lo respetan.
const METODOS_EFECTIVO = new Set(["CO"]);

function getPagoTipo(codigo) {
  return PAGO_TIPOS[codigo] || null;
}

function getTipoGastoGrupoId(codigo) {
  return PAGO_TIPOS[codigo]?.tipoGastoGrupoId ?? PAGO_TIPOS.CO.tipoGastoGrupoId;
}

function getLabel(codigo) {
  return PAGO_TIPOS[codigo]?.label || codigo;
}

function esEfectivo(codigo) {
  return METODOS_EFECTIVO.has(codigo);
}

module.exports = {
  PAGO_TIPOS,
  METODOS_EFECTIVO,
  getPagoTipo,
  getTipoGastoGrupoId,
  getLabel,
  esEfectivo,
};
