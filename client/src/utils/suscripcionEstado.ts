// Estados de display de una suscripción (espejo del enum del backend en
// api/utils/suscripcionEstado.js, pero acá usamos los nombres largos porque
// son los que ve el usuario en la UI).
//
// Códigos persistidos en `suscripcion.SuscripcionEstado` (char 1):
//   'A' = ACTIVA · 'V' = VENCIDA · 'F' = FUTURA · 'C' = CANCELADA · 'S' = SUSPENDIDA
//
// CANCELADA y SUSPENDIDA son decisiones manuales del operador y siempre
// prevalecen sobre el cálculo por fechas. Los demás (A/V/F) los recalculamos
// localmente porque el campo persistido se puede quedar obsoleto cuando
// pasan días y nadie tocó la fila.

import { todayLocalISO } from "./utils";

export type EstadoDisplay =
  | "ACTIVA"
  | "VENCIDA"
  | "FUTURA"
  | "CANCELADA"
  | "SUSPENDIDA";

export interface SuscripcionConFechas {
  SuscripcionEstado?: string;
  SuscripcionFechaInicio?: string;
  SuscripcionFechaFin?: string;
}

// Sólo basado en fechas — útil para casos donde no querés que estados
// manuales contaminen la decisión.
export function calcularEstadoPorFechas(
  fechaInicio?: string,
  fechaFin?: string
): EstadoDisplay {
  if (!fechaInicio || !fechaFin) return "CANCELADA";
  const hoy = todayLocalISO();
  const inicio = fechaInicio.split("T")[0];
  const fin = fechaFin.split("T")[0];
  if (hoy < inicio) return "FUTURA";
  if (hoy > fin) return "VENCIDA";
  return "ACTIVA";
}

// Estado a mostrar en la UI: respeta C/S manuales y recalcula A/V/F por fechas.
export function getEstadoDisplay(s: SuscripcionConFechas): EstadoDisplay {
  if (s.SuscripcionEstado === "C") return "CANCELADA";
  if (s.SuscripcionEstado === "S") return "SUSPENDIDA";
  return calcularEstadoPorFechas(s.SuscripcionFechaInicio, s.SuscripcionFechaFin);
}

export function isEstadoManual(s: SuscripcionConFechas): boolean {
  return s.SuscripcionEstado === "C" || s.SuscripcionEstado === "S";
}

// Estilo (Tailwind) para el badge del estado. Centralizado para que
// CANCELADA en SuscripcionesList se vea igual que en FichaAlumnoPage.
export function estadoBadgeClass(estado: EstadoDisplay): string {
  switch (estado) {
    case "ACTIVA":
      return "bg-green-100 text-green-800";
    case "VENCIDA":
      return "bg-red-100 text-red-800";
    case "FUTURA":
      return "bg-blue-100 text-blue-800";
    case "CANCELADA":
      return "bg-gray-200 text-gray-700";
    case "SUSPENDIDA":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}
