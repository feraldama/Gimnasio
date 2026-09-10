/**
 * PDF del reporte "Suscripciones vigentes por rango de fechas".
 *
 * Es el entregable que el dueño imprime o manda por WhatsApp: arriba el
 * resumen del período y abajo el detalle socio por socio con el inicio y el
 * fin de cada suscripción.
 */
import { loadPdf } from "./lazyPdf";
import { formatDateLocal, formatMiles } from "./utils";
import type { ReporteSuscripcionesVigentesResponse } from "../services/reportes.service";

const ESTADO_LABEL: Record<string, string> = {
  A: "Vigente",
  V: "Vencida",
  F: "Futura",
  C: "Cancelada",
  S: "Suspendida",
};

interface GenerarOpts {
  reporte: ReporteSuscripcionesVigentesResponse;
  /** Filas efectivamente visibles en pantalla (respeta filtros del usuario). */
  filas: ReporteSuscripcionesVigentesResponse["detalle"];
  planNombre?: string | null;
  nombreGimnasio?: string;
}

export async function generarPDFSuscripcionesVigentes(opts: GenerarOpts) {
  const { reporte, filas, planNombre, nombreGimnasio } = opts;
  const { jsPDF, autoTable } = await loadPdf();

  // Apaisado: el detalle tiene ocho columnas y en A4 vertical se aprieta.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  const ahora = new Date();
  const generadoEn = `${formatDateLocal(ahora.toISOString())} ${String(
    ahora.getHours()
  ).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(nombreGimnasio || "GIMNASIO", W / 2, 15, { align: "center" });

  doc.setFontSize(13);
  doc.text("Suscripciones vigentes", W / 2, 22, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    `Del ${formatDateLocal(reporte.fechaDesde)} al ${formatDateLocal(
      reporte.fechaHasta
    )}${planNombre ? ` · Plan: ${planNombre}` : ""}`,
    W / 2,
    29,
    { align: "center" }
  );

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generado: ${generadoEn}`, W - 14, 11, { align: "right" });
  doc.setTextColor(0);

  // ---- Resumen ----
  const r = reporte.resumen;
  const kpis: Array<[string, string]> = [
    [
      "Suscripciones vigentes en el período",
      `${formatMiles(r.suscripciones)}  (${formatMiles(r.socios)} socios distintos)`,
    ],
    [
      `Vigentes al ${formatDateLocal(reporte.fechaDesde)}`,
      formatMiles(r.vigentesAlInicio),
    ],
    [
      `Vigentes al ${formatDateLocal(reporte.fechaHasta)}`,
      formatMiles(r.vigentesAlFin),
    ],
    ["Promedio de vigentes por día", formatMiles(r.promedioDiario)],
    [
      "Día pico",
      r.pico
        ? `${formatMiles(r.pico.suscripciones)} el ${formatDateLocal(r.pico.fecha)}`
        : "—",
    ],
    ["Altas dentro del período", formatMiles(r.altas)],
    ["Vencen dentro del período", formatMiles(r.bajas)],
  ];

  autoTable(doc, {
    startY: 36,
    body: kpis,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1 },
    columnStyles: {
      0: { cellWidth: 80, textColor: [80, 80, 80] },
      1: { cellWidth: 70, fontStyle: "bold" },
    },
    margin: { left: 14 },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } })
    .lastAutoTable?.finalY;
  let y = (finalY ?? 36) + 6;

  if (reporte.incluirCanceladas) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      "Incluye suscripciones canceladas y suspendidas.",
      14,
      y
    );
    doc.setTextColor(0);
    y += 5;
  }

  if (reporte.detalleTruncado) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(180, 80, 0);
    doc.text(
      `El detalle está cortado en ${reporte.limiteDetalle} filas: el resumen de arriba sí cuenta todas.`,
      14,
      y
    );
    doc.setTextColor(0);
    y += 5;
  }

  // ---- Detalle ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Detalle (${formatMiles(filas.length)} suscripciones)`, 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Socio",
        "CI / RUC",
        "Plan",
        "Inicio",
        "Fin",
        "Días en el rango",
        "Estado",
        "Saldo",
      ],
    ],
    body: filas.map((f) => [
      f.socio,
      f.ruc || "—",
      f.plan || "—",
      formatDateLocal(f.fechaInicio),
      formatDateLocal(f.fechaFin),
      String(f.diasEnRango),
      ESTADO_LABEL[f.estado] || f.estado,
      f.saldoPendiente > 0 ? `Gs. ${formatMiles(f.saldoPendiente)}` : "—",
    ]),
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 24 },
      2: { cellWidth: 45 },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 22, halign: "right" },
      6: { cellWidth: 22, halign: "center" },
      7: { cellWidth: "auto", halign: "right" },
    },
    didParseCell: (data) => {
      // Vencidas y canceladas en gris: en un listado de "vigentes" conviene
      // que salte a la vista cuáles ya no lo están HOY.
      if (data.section === "body") {
        const fila = filas[data.row.index];
        if (fila && fila.estado !== "A") {
          data.cell.styles.textColor = [130, 130, 130];
        }
      }
    },
    margin: { left: 14, right: 14 },
  });

  if (filas.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text(
      "No hay suscripciones vigentes en el rango seleccionado.",
      W / 2,
      y + 20,
      { align: "center" }
    );
    doc.setTextColor(0);
  }

  // ---- Pie: numeración ----
  const H = doc.internal.pageSize.getHeight();
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${totalPages}`, W - 14, H - 8, { align: "right" });
    doc.setTextColor(0);
  }

  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const dl = document.createElement("a");
  dl.href = url;
  dl.download = `Suscripciones_vigentes_${reporte.fechaDesde}_a_${reporte.fechaHasta}.pdf`;
  document.body.appendChild(dl);
  dl.click();
  document.body.removeChild(dl);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
