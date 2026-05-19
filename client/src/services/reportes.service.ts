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

async function fetchReporte<T>(path: string, anio: number, mes: number): Promise<T> {
  try {
    const r = await api.get(path, { params: { anio, mes } });
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

export const getReporteCantinaDiario = (anio: number, mes: number) =>
  fetchReporte<ReporteCantinaResponse>("/reportes/cantina/diario", anio, mes);
