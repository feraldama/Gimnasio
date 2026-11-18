// Ticket de cierre de caja (80 mm). Lo imprime el cajero al cerrar
// (AperturaCierreCajaPage) y lo reimprime el administrador desde Corrección de
// caja o desde el reporte "Cierre de caja por rango". Es el mismo dibujo en
// los dos casos; la reimpresión agrega un pie con quién la imprimió, cuántas
// correcciones tuvo el turno después del cierre y el sobrante/faltante que
// tenía esa noche.
import { formatMiles } from "./utils";
import { getTicketTurno } from "../services/correcciones.service";
import { loadPdf } from "./lazyPdf";
import {
  controlEfectivo,
  desglosarIngresos,
  ORIGENES,
  type IngresosPorMedio,
  type MovimientoEfectivo,
} from "./cajaOrigen";

export interface RegistroTicket {
  RegistroDiarioCajaId: number;
  RegistroDiarioCajaFecha: string;
  RegistroDiarioCajaMonto: number;
  TipoGastoId: number;
  TipoGastoGrupoId: number;
  RegistroDiarioCajaDetalle?: string | null;
}

export interface Reimpresion {
  impresoPor: string;
  impresoEn: Date;
  correccionesPosteriores: number;
  /** Sobrante/faltante del ticket original (> 0 faltante). */
  diferenciaAlCerrar: number;
}

export interface DatosTicketCierre {
  fecha: string; // dd/mm/aaaa
  hora: string;
  usuario: string;
  caja: string;
  apertura: number;
  cierre: number;
  /** Movimientos del turno (la apertura y el cierre se ignoran). */
  registros: RegistroTicket[];
  reimpresion?: Reimpresion;
}

function textoSobranteFaltante(diferencia: number, prefijo = ""): string {
  if (diferencia > 0) return `${prefijo}Faltante de: Gs. ${formatMiles(diferencia)}`;
  if (diferencia < 0) return `${prefijo}Sobrante de: Gs. ${formatMiles(-diferencia)}`;
  return `${prefijo}Sobrante/Faltante: Gs. 0`;
}

function fechaHora(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
    hora: d.toLocaleTimeString(),
  };
}

export { fechaHora as fechaHoraTicket };

export async function generarTicketCierrePDF(datos: DatosTicketCierre) {
  const { fecha, hora, usuario, caja, apertura, cierre, registros, reimpresion } = datos;

  let egresos = 0;
  for (const reg of registros) {
    if (reg.TipoGastoId === 1 && reg.TipoGastoGrupoId !== 2) {
      egresos += Number(reg.RegistroDiarioCajaMonto) || 0;
    }
  }
  // Ingresos por origen (gimnasio / productos / otros) y por medio de pago.
  const desglose = desglosarIngresos(registros);
  const totalMedio = (campo: keyof IngresosPorMedio) =>
    ORIGENES.reduce((acc, o) => acc + desglose[o.key][campo], 0);
  const ingresos = totalMedio("efectivo");
  const ingresosPOS = totalMedio("pos");
  const ingresosVoucher = totalMedio("voucher");
  const ingresosTransfer = totalMedio("transfer");
  // Control de efectivo: qué movimientos componen el efectivo esperado, para
  // poder buscar dónde está el sobrante/faltante.
  const control = controlEfectivo(registros, apertura, cierre);
  const txtSobranteFaltante = textoSobranteFaltante(control.diferencia);
  // "Otros" (cancha, etc.) sólo aparece si tuvo movimientos en el turno.
  const origenesTicket = ORIGENES.filter(
    (o) => o.key !== "otros" || desglose.otros.total > 0,
  );
  const totalIngresos = ingresos + ingresosPOS + ingresosVoucher + ingresosTransfer;
  const diferencia = totalIngresos - egresos;

  const { jsPDF } = await loadPdf();
  type Doc = InstanceType<typeof jsPDF>;
  // Recorta el detalle de un movimiento para que no pise el monto.
  const ajustar = (d: Doc, texto: string, ancho: number) => {
    if (d.getTextWidth(texto) <= ancho) return texto;
    let t = texto;
    while (t.length > 1 && d.getTextWidth(t + "…") > ancho) t = t.slice(0, -1);
    return t + "…";
  };
  // Dibuja el ticket y devuelve dónde terminó. Se llama dos veces: una para
  // medir el alto (depende de cuántos movimientos tuvo el turno) y otra en
  // la hoja definitiva.
  const dibujar = (doc: Doc) => {
    doc.setFontSize(16);
    doc.text("RESUMEN CIERRE CAJA", 40, 15, { align: "center" });
    doc.setFontSize(11);
    doc.text(`Fecha: ${fecha} - Hora: ${hora}`, 10, 30);
    doc.text(`Usuario: ${usuario}`, 10, 38);
    doc.text(`Caja: ${caja}`, 10, 46);
    doc.line(10, 50, 200, 50);
    let y = 58;
    doc.text(`Apertura: ${formatMiles(apertura)}`, 10, y);
    y += 8;
    doc.text(`Cierre: ${formatMiles(cierre)}`, 10, y);
    y += 8;
    doc.line(10, y, 200, y);
    y += 8;
    doc.text(`Egresos: ${formatMiles(egresos)}`, 10, y);
    y += 8;
    doc.line(10, y, 200, y);
    y += 8;
    for (const o of origenesTicket) {
      const d = desglose[o.key];
      doc.setFont("helvetica", "bold");
      doc.text(`INGRESOS ${o.label.toUpperCase()}`, 10, y);
      doc.setFont("helvetica", "normal");
      y += 7;
      doc.setFontSize(10);
      doc.text(`Efectivo: ${formatMiles(d.efectivo)}`, 13, y);
      y += 6;
      doc.text(`POS: ${formatMiles(d.pos)}`, 13, y);
      y += 6;
      doc.text(`Voucher: ${formatMiles(d.voucher)}`, 13, y);
      y += 6;
      doc.text(`Transfer: ${formatMiles(d.transfer)}`, 13, y);
      y += 7;
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(`Subtotal ${o.label}: ${formatMiles(d.total)}`, 10, y);
      doc.setFont("helvetica", "normal");
      y += 6;
      doc.line(10, y, 200, y);
      y += 8;
    }
    doc.text(`Ingresos Efectivo: ${formatMiles(ingresos)}`, 10, y);
    y += 8;
    doc.text(`Ingresos POS: ${formatMiles(ingresosPOS)}`, 10, y);
    y += 8;
    doc.text(`Ingresos Voucher: ${formatMiles(ingresosVoucher)}`, 10, y);
    y += 8;
    doc.text(`Ingresos Transfer: ${formatMiles(ingresosTransfer)}`, 10, y);
    y += 8;
    doc.line(10, y, 200, y);
    y += 8;
    doc.text(`Total Ingresos: ${formatMiles(totalIngresos)}`, 10, y);
    y += 8;
    doc.text(`Total Egresos: ${formatMiles(egresos)}`, 10, y);
    y += 8;
    doc.text(`Diferencia: ${formatMiles(diferencia)}`, 10, y);
    y += 8;
    doc.line(10, y, 200, y);
    y += 8;

    // --- Control de efectivo ---
    const linea = (texto: string, monto: string, negrita = false) => {
      doc.setFont("helvetica", negrita ? "bold" : "normal");
      doc.text(texto, 10, y);
      doc.text(monto, 70, y, { align: "right" });
      doc.setFont("helvetica", "normal");
    };
    const movimientos = (lista: MovimientoEfectivo[]) => {
      doc.setFontSize(8);
      for (const m of lista) {
        const monto = formatMiles(m.monto);
        const ancho = 70 - 13 - doc.getTextWidth(monto) - 2;
        doc.text(ajustar(doc, m.detalle, ancho), 13, y);
        doc.text(monto, 70, y, { align: "right" });
        y += 4.5;
      }
      doc.setFontSize(10);
    };
    doc.setFont("helvetica", "bold");
    doc.text("CONTROL DE EFECTIVO", 10, y);
    doc.setFont("helvetica", "normal");
    y += 7;
    doc.setFontSize(10);
    linea("Apertura", formatMiles(control.apertura));
    y += 6;
    for (const o of ORIGENES) {
      const g = control.porOrigen[o.key];
      if (o.key === "otros" && g.movimientos.length === 0) continue;
      linea(`+ Efectivo ${o.label}`, formatMiles(g.total), true);
      y += 5;
      movimientos(g.movimientos);
      y += 1.5;
    }
    linea("- Egresos", formatMiles(control.egresos.total), true);
    y += 5;
    movimientos(control.egresos.movimientos);
    y += 1.5;
    doc.line(10, y - 3, 70, y - 3);
    y += 2;
    linea("Efectivo esperado", formatMiles(control.esperado), true);
    y += 6;
    linea("Cierre declarado", formatMiles(control.declarado));
    y += 8;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(txtSobranteFaltante, 10, y);
    doc.setFont("helvetica", "normal");

    if (reimpresion) {
      y += 8;
      doc.line(10, y - 4, 70, y - 4);
      doc.setFontSize(9);
      // Si el turno cambió después del cierre (correcciones u otra edición),
      // se muestra lo que dio esa noche para comparar con el ticket original.
      const n = reimpresion.correccionesPosteriores;
      const cambio = reimpresion.diferenciaAlCerrar !== control.diferencia;
      if (n > 0 || cambio) {
        doc.text(
          n > 0
            ? `Incluye ${n} ${n === 1 ? "corrección" : "correcciones"} posterior${n === 1 ? "" : "es"} al cierre.`
            : "Tuvo cambios posteriores al cierre.",
          10,
          y,
        );
        y += 5;
        doc.setFont("helvetica", "bold");
        doc.text(textoSobranteFaltante(reimpresion.diferenciaAlCerrar, "Al cerrar: "), 10, y);
        doc.setFont("helvetica", "normal");
        y += 6;
      }
      const imp = fechaHora(reimpresion.impresoEn);
      doc.setFont("helvetica", "bold");
      doc.text("REIMPRESIÓN", 10, y);
      doc.setFont("helvetica", "normal");
      y += 5;
      doc.setFontSize(8);
      doc.text(
        ajustar(doc, `Por ${reimpresion.impresoPor} el ${imp.fecha} ${imp.hora}`, 60),
        10,
        y,
      );
      doc.setFontSize(11);
      y += 4;
    }

    y += 12;
    doc.text("--GRACIAS POR SU PREFERENCIA--", 10, y);
    return y;
  };
  const altoMedido = dibujar(new jsPDF({ unit: "mm", format: [80, 2000] }));
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [80, Math.max(200, altoMedido + 15)], // 80mm de ancho
  });
  dibujar(doc);

  // Descargar y abrir en una pestaña nueva, como siempre.
  const pdfUrl = URL.createObjectURL(doc.output("blob"));
  const link = document.createElement("a");
  link.href = pdfUrl;
  link.download = `ResumenCierreCaja_${fecha.replace(/\//g, "-")}${
    reimpresion ? `_${usuario.replace(/[^\w-]+/g, "_")}` : ""
  }.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    const openLink = document.createElement("a");
    openLink.href = pdfUrl;
    openLink.target = "_blank";
    document.body.appendChild(openLink);
    openLink.click();
    document.body.removeChild(openLink);
  }, 500);
  setTimeout(() => URL.revokeObjectURL(pdfUrl), 2000);
}

/**
 * Reimprime el ticket de cierre de un turno ya cerrado (por su apertura).
 * Fecha y hora son las del cierre real y "Usuario" es el cajero que cerró.
 */
export async function reimprimirTicketCierre(aperturaId: number, impresoPor: string) {
  const t = await getTicketTurno(aperturaId);
  const regs = t.registros.map((r) => ({
    ...r,
    RegistroDiarioCajaMonto: Number(r.RegistroDiarioCajaMonto) || 0,
  }));
  const ap = regs.find((r) => r.RegistroDiarioCajaId === t.turno.aperturaId);
  const ci = regs.find((r) => r.RegistroDiarioCajaId === t.turno.cierreId);
  const { fecha, hora } = fechaHora(new Date(t.turno.cierreFecha));
  await generarTicketCierrePDF({
    fecha,
    hora,
    usuario: t.turno.usuarioNombre || t.turno.usuarioId,
    caja: t.turno.cajaDescripcion || `Caja ${t.turno.cajaId}`,
    apertura: ap?.RegistroDiarioCajaMonto ?? 0,
    cierre: ci?.RegistroDiarioCajaMonto ?? 0,
    registros: regs,
    reimpresion: {
      impresoPor,
      impresoEn: new Date(),
      correccionesPosteriores: t.correccionesPosteriores,
      diferenciaAlCerrar: Number(t.diferenciaAlCerrar) || 0,
    },
  });
}
