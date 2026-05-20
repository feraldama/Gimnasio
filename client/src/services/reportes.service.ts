import api from "./api";
import type { AxiosError } from "axios";

export interface ReporteGimnasioRow {
  semana: string;
  inscriptos: number;
  acumulado: number;
  capacidad: number;
  ocupacionPct: number;
}

export interface ReporteGimnasioResponse {
  anio: number;
  mes: number;
  capacidad: number;
  data: ReporteGimnasioRow[];
  totalInscriptos: number;
  ocupacionFinalPct: number;
}

export interface ReporteCanchaRow {
  dia: number;
  etiqueta: string;
  ingreso: number;
  reservas: number;
  meta: number;
  cumplimientoPct: number;
}

export interface ReporteCanchaResponse {
  anio: number;
  mes: number;
  meta: number;
  data: ReporteCanchaRow[];
  totalIngreso: number;
  diasConIngreso: number;
  promedioDiario: number;
}

export interface ReporteCantinaRow {
  dia: number;
  etiqueta: string;
  recaudado: number;
  cantidadVentas: number;
  efectivo: number;
  valorStock: number;
  rotacionPct: number;
}

export interface ReporteCantinaResponse {
  anio: number;
  mes: number;
  valorStockActual: number;
  data: ReporteCantinaRow[];
  totalRecaudado: number;
}

async function fetchReporte<T>(
  path: string,
  anio: number,
  mes: number,
  extraParams: Record<string, string | number | undefined> = {}
): Promise<T> {
  try {
    const r = await api.get(path, { params: { anio, mes, ...extraParams } });
    return r.data as T;
  } catch (e) {
    const ax = e as AxiosError<{ error?: string; message?: string }>;
    throw (
      ax.response?.data || { message: `Error en reporte ${path}` }
    );
  }
}

export const getReporteGimnasioOcupacion = (anio: number, mes: number) =>
  fetchReporte<ReporteGimnasioResponse>("/reportes/gimnasio/ocupacion", anio, mes);

export const getReporteCanchaDiario = (anio: number, mes: number) =>
  fetchReporte<ReporteCanchaResponse>("/reportes/cancha/diario", anio, mes);

// ---------- Desglose mensual de Cancha ----------
export interface ReporteCanchaDesglosePorCancha {
  canchaId: number;
  canchaNombre: string;
  ingreso: number;
  reservas: number;
  horasOcupadas: number;
  horasDisponibles: number;
  ocupacionPct: number;
}

export interface ReporteCanchaDesglosePorBanda {
  bandaId: number | null;
  nombre: string;
  ingreso: number;
  reservas: number;
}

export interface ReporteCanchaDesgloseResponse {
  anio: number;
  mes: number;
  horario: { inicio: number; fin: number; horasPorDia: number };
  totales: {
    ingreso: number;
    reservas: number;
    horasOcupadas: number;
    horasDisponibles: number;
    ocupacionPct: number;
  };
  porCancha: ReporteCanchaDesglosePorCancha[];
  porBanda: ReporteCanchaDesglosePorBanda[];
}

export const getReporteCanchaDesglose = (
  anio: number,
  mes: number,
  canchaId?: number | null
) =>
  fetchReporte<ReporteCanchaDesgloseResponse>(
    "/reportes/cancha/desglose",
    anio,
    mes,
    canchaId ? { canchaId } : {}
  );

// ---------- Heatmap día-semana × hora ----------
export interface HeatmapCelda {
  dia: number; // 0=Lun..6=Dom
  hora: number;
  reservas: number;
  ingreso: number;
}

export interface ReporteHeatmapResponse {
  anio: number;
  mes: number;
  horario: { inicio: number; fin: number; horasPorDia: number };
  horas: number[];
  matriz: HeatmapCelda[];
  top: HeatmapCelda[];
  porDia: { dia: number; reservas: number; ingreso: number }[];
  totales: { reservas: number; ingreso: number };
}

export const getReporteCanchaHeatmap = (
  anio: number,
  mes: number,
  canchaId?: number | null
) =>
  fetchReporte<ReporteHeatmapResponse>(
    "/reportes/cancha/heatmap",
    anio,
    mes,
    canchaId ? { canchaId } : {}
  );

export const getReporteCantinaDiario = (anio: number, mes: number) =>
  fetchReporte<ReporteCantinaResponse>("/reportes/cantina/diario", anio, mes);
