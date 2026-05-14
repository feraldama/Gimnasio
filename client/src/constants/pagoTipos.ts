export const PAGO_TIPOS = {
  CO: { codigo: "CO", label: "Contado" },
  PO: { codigo: "PO", label: "POS" },
  TR: { codigo: "TR", label: "Transferencia" },
} as const;

export type PagoTipoCodigo = keyof typeof PAGO_TIPOS;

export const getPagoTipoLabel = (codigo: string): string =>
  PAGO_TIPOS[codigo as PagoTipoCodigo]?.label || codigo;

export const PAGO_TIPOS_LIST = Object.values(PAGO_TIPOS);
