export const formatMiles = (value: number | string): string => {
  const parseToNumber = (value: number | string): number => {
    if (typeof value === "string") {
      return parseFloat(value.replace(/\./g, "").replace(",", "."));
    }
    return value;
  };
  const commission = parseToNumber(value);
  const roundedCommission = Math.round(commission);
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    useGrouping: true,
  }).format(roundedCommission);
};

export const formatMilesWithDecimals = (value: number | string): string => {
  const parseToNumber = (value: number | string): number => {
    if (typeof value === "string") {
      // Si el string ya es un número válido, úsalo directamente
      if (/^\d+\.?\d*$/.test(value) && value.includes(".")) {
        return parseFloat(value);
      }
      // Si tiene formato español con comas como decimales
      return parseFloat(value.replace(/\./g, "").replace(",", "."));
    }
    return value;
  };
  const commission = parseToNumber(value);
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(commission);
};

export const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: "PYG",
  }).format(value);
};

// Helpers de fecha en zona horaria local.
// `new Date("YYYY-MM-DD")` se interpreta como UTC; en GMT-3 eso retrocede un día.
// Estas funciones operan sobre strings YYYY-MM-DD sin pasar por Date donde es posible.

export const todayLocalISO = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const toLocalISODate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const addDaysLocal = (yyyymmdd: string, days: number): string => {
  if (!yyyymmdd) return "";
  const [y, m, d] = yyyymmdd.split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return "";
  // Date constructor con números individuales usa zona local — no hay desplazamiento UTC
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toLocalISODate(date);
};

export const formatDateLocal = (dateString: string): string => {
  if (!dateString) return "";
  // Aceptamos YYYY-MM-DD o YYYY-MM-DDTHH:mm:ssZ. En ambos casos tomamos solo la parte de fecha.
  const datePart = dateString.split("T")[0];
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return dateString;
  return `${d}/${m}/${y}`;
};

// Fecha + hora en formato local `dd/mm/aaaa HH:mm`.
// Para columnas TIMESTAMP usar `new Date(s).getHours()` (zona local), no
// regex sobre el ISO (saldría UTC y se corre 3h en GMT-3).
export const formatDateTimeLocal = (dateString: string): string => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return formatDateLocal(dateString);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
};

// Interfaz para los items del carrito
export interface CarritoItem {
  nombre: string;
  cantidad: number;
  precio: number;
}

// Interfaz para el cliente
export interface ClientePresupuesto {
  ClienteNombre: string;
  ClienteApellido: string;
}

import { loadPdf } from "./lazyPdf";

import Swal from "sweetalert2";

// Función para generar PDF de presupuesto
export const generatePresupuestoPDF = async (
  carrito: CarritoItem[],
  cliente?: ClientePresupuesto
) => {
  // Mostrar modal para ingresar observación
  const { value: observacion } = await Swal.fire({
    title: "Agregar Observación",
    input: "textarea",
    inputLabel: "Observación (opcional):",
    inputPlaceholder: "Escriba aquí la observación...",
    showCancelButton: true,
    confirmButtonText: "Generar PDF",
    cancelButtonText: "Cancelar",
    inputValidator: () => {
      // La observación es opcional, no hay validación
      return null;
    },
  });

  // Si el usuario canceló, no generar el PDF
  if (observacion === undefined) {
    return;
  }

  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();
  const clienteNombre = cliente
    ? `${cliente.ClienteNombre} ${cliente.ClienteApellido}`.trim()
    : "SIN NOMBRE";

  // Agregar logo en la esquina superior derecha
  const logo = new Image();
  logo.src = "/src/assets/img/logo.jpg";
  doc.addImage(logo, "JPEG", 165, 10, 20, 20);

  // Agregar fecha y hora actual
  const fechaActual = new Date();
  const dia = String(fechaActual.getDate()).padStart(2, "0");
  const mes = String(fechaActual.getMonth() + 1).padStart(2, "0");
  const año = fechaActual.getFullYear();
  const horas = String(fechaActual.getHours()).padStart(2, "0");
  const minutos = String(fechaActual.getMinutes()).padStart(2, "0");
  const segundos = String(fechaActual.getSeconds()).padStart(2, "0");

  const fechaFormateada = `${dia}/${mes}/${año}`;
  const horaFormateada = `${horas}:${minutos}:${segundos}`;

  doc.setFontSize(22);
  doc.text("Presupuesto", 14, 20);
  doc.setFontSize(14);
  doc.text(`Fecha:    ${fechaFormateada} - Hora: ${horaFormateada}`, 14, 30);
  doc.setFontSize(14);
  doc.text(`Cliente:    ${clienteNombre}`, 14, 40);

  // Tabla de productos
  const headers = [["Producto", "Cantidad", "Precio Unitario", "Total"]];
  const body = carrito.map((item) => [
    item.nombre,
    String(item.cantidad),
    `Gs. ${item.precio.toLocaleString()}`,
    `Gs. ${(item.precio * item.cantidad).toLocaleString()}`,
  ]);

  autoTable(doc, {
    head: headers,
    body: body,
    startY: 45,
    headStyles: {
      fillColor: [41, 128, 185],
      textColor: 255,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 12 },
    styles: { cellPadding: 2 },
    theme: "grid",
    margin: { left: 14, right: 14 },
  });

  // Calcular total
  const subtotal = carrito.reduce(
    (acc, item) => acc + item.precio * item.cantidad,
    0
  );
  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY || 60;

  // Agregar observación si existe
  if (observacion && observacion.trim()) {
    doc.setFontSize(12);
    doc.text("Observación:", 14, finalY + 8);
    doc.setFontSize(12);
    // Dividir la observación en líneas si es muy larga
    const maxWidth = 180; // Ancho máximo del texto
    const lines = doc.splitTextToSize(observacion.trim(), maxWidth);
    doc.text(lines, 14, finalY + 14);

    // Ajustar la posición del total según si hay observación
    const observacionHeight = lines.length * 5; // Altura aproximada de las líneas
    doc.setFontSize(16);
    doc.text(
      `Total: Gs. ${subtotal.toLocaleString()}`,
      14,
      finalY + 12 + observacionHeight + 8
    );
  } else {
    // Si no hay observación, mostrar el total directamente
    doc.setFontSize(16);
    doc.text(`Total: Gs. ${subtotal.toLocaleString()}`, 14, finalY + 16);
  }

  doc.save("presupuesto.pdf");
};
