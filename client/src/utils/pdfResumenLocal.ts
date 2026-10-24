/**
 * PDF del reporte "Resumen por local".
 *
 * Una sola tabla con una columna por local (Salón, Gimnasio, ...) y el total
 * general, para ver cada negocio por separado y el consolidado:
 *   - Ingresos: suscripciones (cobradas) y ventas de productos (facturadas)
 *     por medio de pago.
 *   - Caja: lo que efectivamente se registró en las cajas de cada local,
 *     egresos, y el resultado de los cierres (efectivo esperado, declarado,
 *     faltante y sobrante).
 *   - Control: ventas cobradas que no dejaron movimiento en caja (se vendió
 *     con la caja cerrada); es lo primero a mirar ante un faltante.
 *   - Saldos al día: créditos pendientes y stock valorizado.
 * Al final, el detalle de los cierres con diferencia y de las ventas sin caja.
 *
 * La atribución a cada local la hace la API (reportes.controller →
 * resumenLocal). Lo que no tiene local (0) va a una columna "Sin local" que
 * sólo aparece si tiene montos.
 */
import { loadPdf } from "./lazyPdf";
import { formatMiles } from "./utils";
import { desglosarIngresos, ORIGENES, type ControlEfectivo } from "./cajaOrigen";
import type { ResumenLocalResponse } from "../services/reportes.service";

/** Cierre ya armado (apertura → cierre) por la pantalla de reportes. */
export interface CierreLocal {
  localId: number;
  fechaCierre: string;
  cajaDescripcion: string;
  usuarioId: string;
  control: ControlEfectivo;
}

const MEDIOS: { codigo: string; label: string }[] = [
  { codigo: "CO", label: "Contado" },
  { codigo: "PO", label: "POS" },
  { codigo: "TR", label: "Transferencia" },
  { codigo: "VO", label: "Voucher" },
];

const TIPO_LABEL: Record<string, string> = {
  CO: "Contado",
  PO: "POS",
  TR: "Transferencia",
  VO: "Voucher",
  CR: "Crédito",
};

function fechaLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ddmmyyyy(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export async function generarPDFResumenLocal(
  data: ResumenLocalResponse,
  cierres: CierreLocal[],
) {
  const { fechaDesde, fechaHasta } = data;

  // Movimientos de caja del período (la API trae un día de margen).
  const caja = data.caja.filter((r) => {
    const f = fechaLocal(r.RegistroDiarioCajaFecha);
    return f >= fechaDesde && f <= fechaHasta;
  });

  // ---- Columnas: un local por columna (+ "Sin local" si hace falta) ----
  const hayLocal0 =
    data.ventas.some((r) => r.local_id === 0) ||
    data.suscripciones.some((r) => r.local_id === 0) ||
    data.creditos.some((r) => r.local_id === 0 && r.saldo !== 0) ||
    data.stock.some((r) => r.local_id === 0 && r.valor !== 0) ||
    caja.some((r) => !r.LocalId && r.TipoGastoGrupoId !== 2);
  const columnas = [
    ...data.locales.map((l) => ({ id: Number(l.LocalId), nombre: l.LocalNombre })),
    ...(hayLocal0 ? [{ id: 0, nombre: "Sin local" }] : []),
  ];

  type Valor = (localId: number) => number;
  type Celda = string | { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const body: Celda[][] = [];

  const seccion = (titulo: string) =>
    body.push([
      {
        content: titulo,
        colSpan: columnas.length + 2,
        styles: { fontStyle: "bold", fillColor: [226, 232, 240], textColor: 20 },
      },
    ]);
  const fila = (
    label: string,
    valor: Valor,
    opts: { negrita?: boolean; sangria?: boolean; color?: number[] } = {},
  ) => {
    const valores = columnas.map((c) => valor(c.id));
    const total = valores.reduce((a, b) => a + b, 0);
    const estilo = {
      ...(opts.negrita ? { fontStyle: "bold" } : {}),
      ...(opts.color ? { textColor: opts.color } : {}),
    };
    body.push([
      { content: (opts.sangria ? "    " : "") + label, styles: estilo },
      ...valores.map((v) => ({ content: formatMiles(v), styles: estilo })),
      { content: formatMiles(total), styles: { ...estilo, fontStyle: "bold" } },
    ]);
  };

  const sumar = <T extends { local_id: number }>(
    rows: T[],
    campo: keyof T,
    filtro: (r: T) => boolean = () => true,
  ): Valor => (localId) =>
    rows
      .filter((r) => r.local_id === localId && filtro(r))
      .reduce((acc, r) => acc + (Number(r[campo]) || 0), 0);

  // ---- INGRESOS ----
  seccion("INGRESOS");
  const susc = data.suscripciones;
  fila("Suscripciones (cobrado)", sumar(susc, "total"), { negrita: true });
  for (const m of MEDIOS) {
    if (!susc.some((r) => r.tipo === m.codigo)) continue;
    fila(m.label, sumar(susc, "total", (r) => r.tipo === m.codigo), { sangria: true });
  }
  const otrosTiposSusc = [...new Set(susc.map((r) => r.tipo))].filter(
    (t) => !MEDIOS.some((m) => m.codigo === t),
  );
  for (const t of otrosTiposSusc) {
    fila(TIPO_LABEL[t] || t, sumar(susc, "total", (r) => r.tipo === t), { sangria: true });
  }

  const ventas = data.ventas;
  fila("Ventas de productos (facturado)", sumar(ventas, "total"), { negrita: true });
  // Orden fijo Contado, POS, Transferencia, Voucher, Crédito; lo desconocido al final.
  const orden = (t: string) => {
    const i = Object.keys(TIPO_LABEL).indexOf(t);
    return i === -1 ? 99 : i;
  };
  const tiposVenta = [...new Set(ventas.map((r) => r.tipo))].sort(
    (a, b) => orden(a) - orden(b),
  );
  for (const t of tiposVenta) {
    fila(TIPO_LABEL[t] || t, sumar(ventas, "total", (r) => r.tipo === t), { sangria: true });
  }
  fila("Cantidad de ventas", sumar(ventas, "cantidad"), { sangria: true });
  fila(
    "TOTAL INGRESOS",
    (id) => sumar(susc, "total")(id) + sumar(ventas, "total")(id),
    { negrita: true },
  );

  // ---- CAJA ----
  seccion("CAJA (movimientos registrados en las cajas del local)");
  const cajaDe = (localId: number) => caja.filter((r) => (Number(r.LocalId) || 0) === localId);
  const medioCaja = (campo: "efectivo" | "pos" | "voucher" | "transfer"): Valor => (id) => {
    const d = desglosarIngresos(cajaDe(id));
    return ORIGENES.reduce((acc, o) => acc + d[o.key][campo], 0);
  };
  fila("Ingresos en efectivo", medioCaja("efectivo"), { sangria: true });
  fila("Ingresos POS", medioCaja("pos"), { sangria: true });
  fila("Ingresos voucher", medioCaja("voucher"), { sangria: true });
  fila("Ingresos transferencia", medioCaja("transfer"), { sangria: true });
  fila(
    "Egresos",
    (id) =>
      cajaDe(id)
        .filter((r) => r.TipoGastoId === 1 && r.TipoGastoGrupoId !== 2)
        .reduce((a, r) => a + (Number(r.RegistroDiarioCajaMonto) || 0), 0),
    { sangria: true },
  );
  const cierresDe = (id: number) => cierres.filter((c) => c.localId === id);
  fila("Cierres realizados", (id) => cierresDe(id).length, { sangria: true });
  fila(
    "Efectivo esperado en cierres",
    (id) => cierresDe(id).reduce((a, c) => a + c.control.esperado, 0),
    { sangria: true },
  );
  fila(
    "Efectivo declarado en cierres",
    (id) => cierresDe(id).reduce((a, c) => a + c.control.declarado, 0),
    { sangria: true },
  );
  fila(
    "Faltante",
    (id) => cierresDe(id).reduce((a, c) => a + Math.max(0, c.control.diferencia), 0),
    { negrita: true, color: [185, 28, 28] },
  );
  fila(
    "Sobrante",
    (id) => cierresDe(id).reduce((a, c) => a + Math.max(0, -c.control.diferencia), 0),
    { negrita: true, color: [180, 83, 9] },
  );

  // ---- CONTROL ----
  seccion("CONTROL");
  const sinCaja = data.ventasSinCaja;
  fila("Ventas cobradas sin caja (monto)", sumar(sinCaja, "VentaEntrega"), {
    sangria: true,
    color: sinCaja.length > 0 ? [185, 28, 28] : undefined,
  });
  fila("Ventas cobradas sin caja (cantidad)", (id) =>
    sinCaja.filter((v) => v.local_id === id).length, { sangria: true });

  // ---- SALDOS ----
  seccion("SALDOS AL DÍA DE HOY (no dependen del período)");
  fila("Créditos de clientes pendientes", sumar(data.creditos, "saldo"), { sangria: true });
  fila("Stock valorizado (a costo)", sumar(data.stock, "valor"), { sangria: true });

  // ---- Documento ----
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ orientation: "portrait", format: "a4" });
  type ConTabla = { lastAutoTable: { finalY: number } };
  const finalY = () => (doc as unknown as ConTabla).lastAutoTable.finalY;

  doc.setFontSize(16);
  doc.text("Resumen por local", 14, 16);
  doc.setFontSize(10);
  doc.text(`Período: ${ddmmyyyy(fechaDesde)} al ${ddmmyyyy(fechaHasta)}`, 14, 23);

  autoTable(doc, {
    head: [["Concepto", ...columnas.map((c) => c.nombre), "TOTAL GENERAL"]],
    body,
    startY: 29,
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], fontSize: 9, halign: "right" },
    styles: { fontSize: 8.5, cellPadding: 1.6 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 72, halign: "left" },
      ...Object.fromEntries(
        Array.from({ length: columnas.length + 1 }, (_, i) => [i + 1, { halign: "right" }]),
      ),
    },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index === 0) h.cell.styles.halign = "left";
    },
  });

  let y = finalY() + 6;
  doc.setFontSize(7.5);
  doc.setTextColor(100);
  for (const nota of [
    "Suscripciones: local del usuario que cobró. Ventas: almacén de la venta. Caja: local de la caja (pantalla Cajas).",
    "Faltante/sobrante: efectivo esperado (apertura + ingresos en efectivo - egresos) menos el cierre declarado por el cajero.",
    "Ventas sin movimiento en caja: se cobraron con la caja del usuario cerrada; ese dinero no figura en ningún cierre.",
  ]) {
    doc.text(nota, 14, y);
    y += 3.6;
  }
  doc.setTextColor(0);

  const nombreLocal = (id: number) =>
    columnas.find((c) => c.id === id)?.nombre || (id ? String(id) : "Sin local");

  // ---- Detalle: cierres con diferencia ----
  const conDiferencia = cierres.filter((c) => c.control.diferencia !== 0);
  if (conDiferencia.length > 0) {
    doc.setFontSize(10);
    y += 6;
    doc.text("Cierres con diferencia", 14, y);
    autoTable(doc, {
      head: [["Local", "Fecha", "Caja", "Usuario", "Esperado", "Declarado", "Faltante / Sobrante"]],
      body: conDiferencia.map((c) => [
        nombreLocal(c.localId),
        c.fechaCierre,
        c.cajaDescripcion,
        c.usuarioId,
        formatMiles(c.control.esperado),
        formatMiles(c.control.declarado),
        {
          content:
            c.control.diferencia > 0
              ? `Falt. ${formatMiles(c.control.diferencia)}`
              : `Sobr. ${formatMiles(-c.control.diferencia)}`,
          styles: { textColor: c.control.diferencia > 0 ? [185, 28, 28] : [180, 83, 9] },
        },
      ]),
      startY: y + 3,
      theme: "grid",
      headStyles: { fillColor: [71, 85, 105], fontSize: 8.5 },
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    });
    y = finalY();
  }

  // ---- Detalle: ventas sin caja ----
  if (sinCaja.length > 0) {
    doc.setFontSize(10);
    y += 8;
    doc.text("Ventas cobradas sin movimiento en caja", 14, y);
    autoTable(doc, {
      head: [["Local", "Venta N°", "Fecha", "Usuario", "Tipo", "Cobrado"]],
      body: sinCaja.map((v) => {
        const d = new Date(v.VentaFecha);
        return [
          nombreLocal(v.local_id),
          String(v.VentaId),
          `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
          v.VentaUsuario,
          TIPO_LABEL[v.VentaTipo] || v.VentaTipo,
          formatMiles(v.VentaEntrega),
        ];
      }),
      startY: y + 3,
      theme: "grid",
      headStyles: { fillColor: [71, 85, 105], fontSize: 8.5 },
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      columnStyles: { 5: { halign: "right" } },
    });
  }

  doc.save(`resumen_por_local_${fechaDesde}_${fechaHasta}.pdf`);
  const url = URL.createObjectURL(doc.output("blob"));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
