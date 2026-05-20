/**
 * PDF semanal de una cancha: 7 días (lun a dom) con sus reservas.
 * Pensado para imprimir el plan semanal de una cancha específica.
 */
import { loadPdf } from "./lazyPdf";
import { formatMiles, formatDateLocal } from "./utils";
import type { Cancha, CanchaReserva } from "../services/cancha.service";

interface GenerarSemanaOpts {
  cancha: Cancha;
  fechas: string[]; // 7 fechas ISO "YYYY-MM-DD"
  reservasPorFecha: Record<string, CanchaReserva[]>;
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

const DIAS_LABELS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

function nombreCliente(r: CanchaReserva): string {
  if (r.ClienteNombre)
    return `${r.ClienteNombre} ${r.ClienteApellido ?? ""}`.trim();
  return r.CanchaReservaCliente || "Invitado";
}

export async function generarPDFReservasSemana(opts: GenerarSemanaOpts) {
  const { cancha, fechas, reservasPorFecha, nombreGimnasio } = opts;
  const { jsPDF, autoTable } = await loadPdf();

  // Landscape para que entren 7 columnas cómodas si se decide a futuro un
  // layout en grilla. Por ahora usamos una sección por día (apilado vertical)
  // pero landscape deja más aire para nombres largos de clientes.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  const ahora = new Date();
  const generadoEn = `${formatDateLocal(ahora.toISOString())} ${String(
    ahora.getHours()
  ).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(nombreGimnasio || "GIMNASIO", W / 2, 14, { align: "center" });
  doc.setFontSize(13);
  doc.text(`Plan semanal — ${cancha.CanchaNombre}`, W / 2, 22, {
    align: "center",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const desde = fechas[0] ? formatDateLocal(fechas[0]) : "";
  const hasta = fechas[6] ? formatDateLocal(fechas[6]) : "";
  doc.text(`Semana del ${desde} al ${hasta}`, W / 2, 28, { align: "center" });

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generado: ${generadoEn}`, W - 14, 10, { align: "right" });
  doc.setTextColor(0);

  // Totales semanales
  const todas: CanchaReserva[] = fechas.flatMap(
    (f) => reservasPorFecha[f] || []
  );
  const activas = todas.filter((r) => r.CanchaReservaEstado !== "X");
  const pagadas = todas.filter((r) => r.CanchaReservaEstado === "P");
  const ingresoSemana = activas.reduce(
    (a, r) => a + Number(r.CanchaReservaMonto || 0),
    0
  );
  const ingresoCobrado = pagadas.reduce(
    (a, r) => a + Number(r.CanchaReservaMonto || 0),
    0
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(
    `Reservas activas: ${activas.length}   |   Pagadas: ${pagadas.length}   |   Cobrado: Gs. ${formatMiles(
      ingresoCobrado
    )}   |   Esperado: Gs. ${formatMiles(ingresoSemana)}`,
    14,
    36
  );

  let y = 42;

  // Una sección por día
  let huboReservas = false;
  fechas.forEach((f, idx) => {
    const lista = (reservasPorFecha[f] || [])
      .slice()
      .sort((a, b) =>
        (a.CanchaReservaHoraInicio || "").localeCompare(
          b.CanchaReservaHoraInicio || ""
        )
      );
    if (y > 180) {
      doc.addPage();
      y = 20;
    }

    const [yr, mo, da] = f.split("-").map(Number);
    const dt = new Date(yr, mo - 1, da);
    const titulo = `${DIAS_LABELS[idx]} — ${String(dt.getDate()).padStart(
      2,
      "0"
    )}/${String(dt.getMonth() + 1).padStart(2, "0")}`;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(titulo, 14, y);
    y += 2;

    if (lista.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(140);
      doc.text("Sin reservas", 14, y + 4);
      doc.setTextColor(0);
      y += 9;
      return;
    }
    huboReservas = true;

    const rows = lista.map((r) => [
      `${tsToHHMM(r.CanchaReservaHoraInicio)} — ${tsToHHMM(
        r.CanchaReservaHoraFin
      )}`,
      nombreCliente(r),
      ESTADO_LABEL[r.CanchaReservaEstado] || r.CanchaReservaEstado,
      `Gs. ${formatMiles(r.CanchaReservaMonto || 0)}`,
      r.CanchaReservaObservacion || "",
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Horario", "Cliente", "Estado", "Monto", "Observación"]],
      body: rows,
      theme: "grid",
      headStyles: { fillColor: [37, 99, 235], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 32, halign: "center" },
        1: { cellWidth: 60 },
        2: { cellWidth: 24, halign: "center" },
        3: { cellWidth: 30, halign: "right" },
        4: { cellWidth: "auto" },
      },
      didParseCell: (data) => {
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
    y = (ft ?? y) + 5;

    const subtotal = lista
      .filter((r) => r.CanchaReservaEstado !== "X")
      .reduce((a, r) => a + Number(r.CanchaReservaMonto || 0), 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Subtotal ${DIAS_LABELS[idx]}: Gs. ${formatMiles(subtotal)}`, W - 14, y, {
      align: "right",
    });
    y += 7;
  });

  if (!huboReservas) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text(
      "No hay reservas registradas para esta semana.",
      W / 2,
      y + 10,
      { align: "center" }
    );
    doc.setTextColor(0);
  }

  // Pie de pagina con numeración
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${totalPages}`, W - 14, 205, { align: "right" });
    doc.setTextColor(0);
  }

  // Descarga + abre en pestaña nueva
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const dl = document.createElement("a");
  dl.href = url;
  dl.download = `Reservas_Semana_${cancha.CanchaNombre.replace(/\s+/g, "_")}_${fechas[0]}.pdf`;
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
