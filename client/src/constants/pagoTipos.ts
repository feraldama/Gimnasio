// Códigos alineados con api/constants/pagoTipos.js (tipoGastoGrupoId entre
// paréntesis): CO=1 (suma a caja), PO=4, VO=5, TR=6. Sólo CO ingresa al
// cajón físico — el resto queda registrado en planilla pero no toca CajaMonto.
export const PAGO_TIPOS = {
  CO: { codigo: "CO", label: "Contado" },
  PO: { codigo: "PO", label: "POS" },
  VO: { codigo: "VO", label: "Voucher" },
  TR: { codigo: "TR", label: "Transferencia" },
} as const;

export type PagoTipoCodigo = keyof typeof PAGO_TIPOS;

export const getPagoTipoLabel = (codigo: string): string =>
  PAGO_TIPOS[codigo as PagoTipoCodigo]?.label || codigo;

export const PAGO_TIPOS_LIST = Object.values(PAGO_TIPOS);
