// Desglose de los ingresos de caja por origen (Gimnasio / Productos / Otros)
// y por medio de pago. Lo usan el ticket de cierre y el reporte "Ingresos por
// origen", para que los dos sumen exactamente lo mismo.
//
// `registrodiariocaja` no tiene columna de origen: lo único que lo identifica
// es el texto del detalle que arma cada controller de la API:
//   - pago.controller           → "Pago suscripción #<id> - <Método>"
//   - venta.controller          → "Venta N°: ", "Venta POS N°: ", "Venta Transferencia N°: "...
//   - ventacreditopago.controller → "Cobro Crédito Efectivo N°: ", "Cobro Crédito POS N°: "...
// Lo que no matchea (cobros de cancha "<Método> <CLIENTE> #<id>", etc.) va a
// "otros". Si se cambia alguno de esos textos en la API, hay que revisar acá.

export type OrigenIngreso = "gimnasio" | "productos" | "otros";

export interface IngresosPorMedio {
  efectivo: number;
  pos: number;
  voucher: number;
  transfer: number;
  total: number;
}

export type DesgloseIngresos = Record<OrigenIngreso, IngresosPorMedio>;

interface RegistroCaja {
  TipoGastoId: number;
  TipoGastoGrupoId: number;
  RegistroDiarioCajaMonto: number;
  RegistroDiarioCajaDetalle?: string | null;
}

export const ORIGENES: { key: OrigenIngreso; label: string }[] = [
  { key: "gimnasio", label: "Gimnasio" },
  { key: "productos", label: "Productos" },
  { key: "otros", label: "Otros" },
];

export function origenDeDetalle(detalle?: string | null): OrigenIngreso {
  const d = (detalle || "").trim().toLowerCase();
  if (d.startsWith("pago suscripci")) return "gimnasio";
  if (d.startsWith("venta ") || d.startsWith("cobro crédito") || d.startsWith("cobro credito"))
    return "productos";
  return "otros";
}

// Misma regla que el ticket de cierre: los grupos 4/5/6 son POS/Voucher/
// Transferencia y cualquier otro ingreso (venta, venta crédito, cobro cancha)
// cuenta como efectivo. La apertura (grupo 2) no es un ingreso.
function medioDeGrupo(grupoId: number): keyof Omit<IngresosPorMedio, "total"> {
  if (grupoId === 4) return "pos";
  if (grupoId === 5) return "voucher";
  if (grupoId === 6) return "transfer";
  return "efectivo";
}

const vacio = (): IngresosPorMedio => ({
  efectivo: 0,
  pos: 0,
  voucher: 0,
  transfer: 0,
  total: 0,
});

export function desgloseVacio(): DesgloseIngresos {
  return { gimnasio: vacio(), productos: vacio(), otros: vacio() };
}

export function desglosarIngresos(registros: RegistroCaja[]): DesgloseIngresos {
  const res = desgloseVacio();
  for (const r of registros) {
    if (r.TipoGastoId !== 2 || r.TipoGastoGrupoId === 2) continue;
    const monto = Number(r.RegistroDiarioCajaMonto) || 0;
    const fila = res[origenDeDetalle(r.RegistroDiarioCajaDetalle)];
    fila[medioDeGrupo(r.TipoGastoGrupoId)] += monto;
    fila.total += monto;
  }
  return res;
}

export function sumarDesgloses(a: DesgloseIngresos, b: DesgloseIngresos): DesgloseIngresos {
  const res = desgloseVacio();
  for (const { key } of ORIGENES) {
    for (const campo of Object.keys(res[key]) as (keyof IngresosPorMedio)[]) {
      res[key][campo] = a[key][campo] + b[key][campo];
    }
  }
  return res;
}
