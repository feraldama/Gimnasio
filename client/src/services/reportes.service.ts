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

// ---------- Suscripciones vigentes por rango de fechas ----------
// Ojo con la diferencia respecto de `getReporteGimnasioOcupacion`: aquel
// cuenta INSCRIPCIONES del mes (agrupa por fecha de inicio), éste cuenta
// cuántas suscripciones están VIGENTES, que incluye las que arrancaron antes
// del rango y siguen corriendo.

/** Un punto de la serie: es un stock (foto del día), no un acumulado. */
export interface SuscripcionesVigentesPunto {
  fecha: string;
  suscripciones: number;
  socios: number;
}

export interface SuscripcionVigenteDetalle {
  suscripcionId: number;
  clienteId: number;
  socio: string;
  ruc: string;
  telefono: string;
  planId: number;
  plan: string;
  planPrecio: number;
  modalidad: string;
  clasesRestantes: number;
  fechaInicio: string;
  fechaFin: string;
  /** Días de esta suscripción que caen dentro del rango consultado. */
  diasEnRango: number;
  diasTotales: number;
  /** Vigencia a HOY: A activa, V vencida, F futura, C cancelada, S suspendida. */
  estado: string;
  estadoPago: "PAGADA" | "PENDIENTE";
  totalPagado: number;
  saldoPendiente: number;
}

export interface ReporteSuscripcionesVigentesResponse {
  fechaDesde: string;
  fechaHasta: string;
  dias: number;
  /** Grano de la serie, elegido por el backend según el largo del rango. */
  paso: "dia" | "semana" | "mes";
  planId: number | null;
  incluirCanceladas: boolean;
  resumen: {
    suscripciones: number;
    socios: number;
    altas: number;
    bajas: number;
    completas: number;
    vigentesAlInicio: number;
    sociosAlInicio: number;
    vigentesAlFin: number;
    sociosAlFin: number;
    promedioDiario: number;
    pico: SuscripcionesVigentesPunto | null;
  };
  serie: SuscripcionesVigentesPunto[];
  detalle: SuscripcionVigenteDetalle[];
  detalleTruncado: boolean;
  limiteDetalle: number;
}

export interface SuscripcionesVigentesOpts {
  planId?: number | null;
  incluirCanceladas?: boolean;
  limite?: number;
}

export const getReporteSuscripcionesVigentes = async (
  fechaDesde: string,
  fechaHasta: string,
  opts: SuscripcionesVigentesOpts = {}
): Promise<ReporteSuscripcionesVigentesResponse> => {
  try {
    const r = await api.get("/reportes/gimnasio/suscripciones-vigentes", {
      params: {
        fechaDesde,
        fechaHasta,
        ...(opts.planId ? { planId: opts.planId } : {}),
        ...(opts.incluirCanceladas ? { incluirCanceladas: 1 } : {}),
        ...(opts.limite ? { limite: opts.limite } : {}),
      },
    });
    return r.data as ReporteSuscripcionesVigentesResponse;
  } catch (e) {
    const ax = e as AxiosError<{ error?: string; message?: string }>;
    throw (
      ax.response?.data || {
        message: "Error al obtener el reporte de suscripciones vigentes",
      }
    );
  }
};

export interface DashboardGimnasioKpis {
  sociosActivos: number;
  proximosAVencer7d: number;
  cobradoHoy: number;
  cobrosHoy: number;
  asistenciasHoy: number;
}

export const getDashboardGimnasioKpis = async (): Promise<DashboardGimnasioKpis> => {
  try {
    const r = await api.get("/reportes/dashboard/gimnasio-kpis");
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener KPIs" };
  }
};
