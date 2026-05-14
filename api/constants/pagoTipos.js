// Catálogo central de tipos de pago de suscripción.
// Si en algún momento se quieren mover a BD, esta constante puede ser
// reemplazada por una consulta a tipogastogrupo cacheada.
const PAGO_TIPOS = {
  CO: { codigo: "CO", label: "Contado", tipoGastoGrupoId: 1 },
  PO: { codigo: "PO", label: "POS", tipoGastoGrupoId: 4 },
  TR: { codigo: "TR", label: "Transferencia", tipoGastoGrupoId: 6 },
};

function getPagoTipo(codigo) {
  return PAGO_TIPOS[codigo] || null;
}

function getTipoGastoGrupoId(codigo) {
  return PAGO_TIPOS[codigo]?.tipoGastoGrupoId ?? PAGO_TIPOS.CO.tipoGastoGrupoId;
}

function getLabel(codigo) {
  return PAGO_TIPOS[codigo]?.label || codigo;
}

module.exports = { PAGO_TIPOS, getPagoTipo, getTipoGastoGrupoId, getLabel };
