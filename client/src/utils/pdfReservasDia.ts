/**
 * Generador del PDF "Reservas del día" para Cancha.
 * Agrupa las reservas por cancha, muestra KPIs arriba y una tabla por cancha
 * con horario, cliente, estado y monto. Pensado para imprimir o entregar al
 * staff al inicio del día.
 */
import { loadPdf } from "./lazyPdf";
import { formatMiles, formatDateLocal } from "./utils";
import type { Cancha, CanchaReserva } from "../services/cancha.service";

interface GenerarOpts {
  fecha: string;
  canchas: Cancha[];
  reservas: CanchaReserva[];
  nombreGimnasio?: string;
}

function tsToHHMM(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    const m = ts.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : "—";
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

const ESTADO_LABEL: Record<string, string> = {
  R: "Reservada",
  P: "Pagada",
  X: "Cancelada",
};

function nombreCliente(r: CanchaReserva): string {
  if (r.ClienteNombre)
    return `${r.ClienteNombre} ${r.ClienteApellido ?? ""}`.trim();
  return r.CanchaReservaCliente || "Invitado";
}

export async function generarPDFReservasDia(opts: GenerarOpts) {
  const { fecha, canchas, reservas, nombreGimnasio } = opts;
  const { jsPDF, autoTable } = await loadPdf();

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const W = doc.internal.pageSize.getWidth();
  const ahora = new Date();
  const generadoEn = `${formatDateLocal(ahora.toISOString())} ${String(
    ahora.getHours()
  ).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(nombreGimnasio || "GIMNASIO", W / 2, 16, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Reservas de cancha", W / 2, 24, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Día: ${formatDateLocal(fecha)}`, W / 2, 31, { align: "center" });

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generado: ${generadoEn}`, W - 14, 12, { align: "right" });
  doc.setTextColor(0);

  // ---- KPIs ----
  const activas = reservas.filter((r) => r.CanchaReservaEstado !== "X");
  const pagadas = reservas.filter((r) => r.CanchaReservaEstado === "P");
  const reservadas = reservas.filter((r) => r.CanchaReservaEstado === "R");
  const canceladas = reservas.filter((r) => r.CanchaReservaEstado === "X");
  const ingresoPagado = pagadas.reduce(
    (a, r) => a + Number(r.CanchaReservaMonto || 0),
    0
  );
  const ingresoEsperado = activas.reduce(
    (a, r) => a + Number(r.CanchaReservaMonto || 0),
    0
  );

  let y = 40;
  doc.setDrawColor(220);
  doc.setLineWidth(0.2);
  doc.line(14, y, W - 14, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Resumen del día", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");

  const kpiRows: Array<[string, string]> = [
    ["Total reservas (activas)", String(activas.length)],
    ["Pagadas", String(pagadas.length)],
    ["Reservadas (pendientes de pago)", String(reservadas.length)],
    ["Canceladas", String(canceladas.length)],
    ["Ingreso ya cobrado", `Gs. ${formatMiles(ingresoPagado)}`],
    ["Ingreso esperado total", `Gs. ${formatMiles(ingresoEsperado)}`],
  ];

  autoTable(doc, {
    startY: y,
    body: kpiRows,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1 },
    columnStyles: {
      0: { cellWidth: 70, textColor: [80, 80, 80] },
      1: { cellWidth: 50, fontStyle: "bold", halign: "right" },
    },
    margin: { left: 14 },
  });

  // autoTable expone finalY en el plugin attached al doc.
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } })
    .lastAutoTable?.finalY;
  y = (finalY ?? y) + 8;

  doc.setDrawColor(220);
  doc.line(14, y, W - 14, y);
  y += 6;

  // ---- Por cancha ----
  // Agrupar reservas por cancha. Mostramos primero las canchas que tengan
  // reservas hoy; si no hay reservas en una cancha activa la omitimos.
  const porCancha = new Map<number, CanchaReserva[]>();
  for (const r of reservas) {
    if (!porCancha.has(r.CanchaId)) porCancha.set(r.CanchaId, []);
    porCancha.get(r.CanchaId)!.push(r);
  }
  // Orden de canchas: el que pasaron en el array.
  const canchaOrden = canchas.length
    ? canchas
    : Array.from(porCancha.keys()).map((id) => ({
        CanchaId: id,
        CanchaNombre: `Cancha ${id}`,
        CanchaTarifaHora: 0,
        CanchaActiva: 1,
      }));

  let huboReservas = false;
  for (const cancha of canchaOrden) {
    const lista = (porCancha.get(cancha.CanchaId) || []).slice().sort((a, b) =>
      (a.CanchaReservaHoraInicio || "").localeCompare(b.CanchaReservaHoraInicio || "")
    );
    if (lista.length === 0) continue;
    huboReservas = true;

    // Header de cancha
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(cancha.CanchaNombre, 14, y);
    if (cancha.CanchaTarifaHora > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Tarifa base: Gs. ${formatMiles(cancha.CanchaTarifaHora)} / hora`,
        W - 14,
        y,
        { align: "right" }
      );
      doc.setTextColor(0);
    }
    y += 3;

    const bodyRows = lista.map((r) => [
      `${tsToHHMM(r.CanchaReservaHoraInicio)} — ${tsToHHMM(r.CanchaReservaHoraFin)}`,
      nombreCliente(r),
      ESTADO_LABEL[r.CanchaReservaEstado] || r.CanchaReservaEstado,
      `Gs. ${formatMiles(r.CanchaReservaMonto || 0)}`,
      r.CanchaReservaObservacion || "",
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Horario", "Cliente", "Estado", "Monto", "Observación"]],
      body: bodyRows,
      theme: "grid",
      headStyles: { fillColor: [37, 99, 235], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 30, halign: "center" },
        1: { cellWidth: 55 },
        2: { cellWidth: 22, halign: "center" },
        3: { cellWidth: 28, halign: "right" },
        4: { cellWidth: "auto" },
      },
      didParseCell: (data) => {
        // Filas canceladas: gris claro y tachado visual (cursiva).
        if (data.section === "body") {
          const row = lista[data.row.index];
          if (row?.CanchaReservaEstado === "X") {
            data.cell.styles.textColor = [150, 150, 150];
            data.cell.styles.fontStyle = "italic";
          }
        }
      },
      margin: { left: 14, right: 14 },
    });

    const ft = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable?.finalY;
    y = (ft ?? y) + 6;

    // Subtotal por cancha
    const subtotal = lista
      .filter((r) => r.CanchaReservaEstado !== "X")
      .reduce((a, r) => a + Number(r.CanchaReservaMonto || 0), 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Subtotal: Gs. ${formatMiles(subtotal)}`, W - 14, y, {
      align: "right",
    });
    y += 6;
  }

  if (!huboReservas) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text(
      "No hay reservas registradas para este día.",
      W / 2,
      y + 10,
      { align: "center" }
    );
    doc.setTextColor(0);
  }

  // ---- Pie de página: numeración ----
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${totalPages}`, W - 14, 290, { align: "right" });
    doc.setTextColor(0);
  }

  // Descargar y abrir en pestaña nueva (mismo patrón que el cierre de caja).
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const dl = document.createElement("a");
  dl.href = url;
  dl.download = `Reservas_${fecha}.pdf`;
  document.body.appendChild(dl);
  dl.click();
  document.body.removeChild(dl);

  setTimeout(() => {
    const open = document.createElement("a");
    open.href = url;
    open.target = "_blank";
    document.body.appendChild(open);
    open.click();
    document.body.removeChild(open);
  }, 200);

  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
