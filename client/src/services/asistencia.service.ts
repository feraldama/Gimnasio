import api from "./api";
import type { AxiosError } from "axios";

export interface EstadoAcceso {
  permitido: boolean;
  motivo: string;
  cliente: {
    ClienteId: number;
    ClienteNombre: string;
    ClienteApellido?: string;
    ClienteTelefono?: string;
  } | null;
  suscripcion: {
    SuscripcionId: number;
    SuscripcionFechaInicio: string;
    SuscripcionFechaFin: string;
    SuscripcionEstado: string;
    SuscripcionClasesRestantes?: number;
    PlanId: number;
    PlanNombre: string;
    PlanPermiteClases: number | boolean;
    PlanModalidad?: string;
    PlanCantidadClases?: number;
  } | null;
  asistenciaHoy?: {
    AsistenciaId: number;
    AsistenciaHoraEntrada: string;
  } | null;
}

export const getEstadoAcceso = async (
  clienteId: string | number
): Promise<EstadoAcceso> => {
  try {
    const response = await api.get(`/asistencia/estado/${clienteId}`);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al obtener estado" };
  }
};

export const registrarAsistencia = async (clienteId: string | number) => {
  try {
    const response = await api.post("/asistencia", { ClienteId: clienteId });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al registrar asistencia" };
  }
};

// Endpoint del modo kiosko: el cliente tipea su CI (ClienteRUC) y en una sola
// llamada el backend valida + registra asistencia si corresponde.
export const registrarKioskoAsistencia = async (
  ci: string
): Promise<EstadoAcceso> => {
  try {
    const response = await api.post("/asistencia/kiosko", { ci });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<EstadoAcceso & { message?: string }>;
    // El backend devuelve la forma de EstadoAcceso incluso en errores logicos,
    // asi que si el cuerpo viene con `permitido`, lo propagamos.
    if (axiosError.response?.data && "permitido" in axiosError.response.data) {
      throw axiosError.response.data;
    }
    throw {
      permitido: false,
      motivo: "Error de red",
      cliente: null,
      suscripcion: null,
    };
  }
};

export const listarAsistenciasDelDia = async (fecha?: string) => {
  try {
    const response = await api.get("/asistencia", {
      params: fecha ? { fecha } : undefined,
    });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al listar asistencias" };
  }
};

export interface RankingAsistenciaRow {
  ClienteId: number;
  ClienteNombre: string;
  ClienteApellido: string;
  ClienteTelefono: string;
  cantidad: number;
  diasDistintos: number;
  primeraFecha: string;
  ultimaFecha: string;
}

export interface AsistenciaItem {
  AsistenciaId: number;
  ClienteId: number;
  AsistenciaFecha: string;
  AsistenciaHoraEntrada: string;
}

export const getAsistenciasPorCliente = async (
  clienteId: string | number,
  limit = 100
): Promise<AsistenciaItem[]> => {
  try {
    const response = await api.get(`/asistencia/cliente/${clienteId}`, {
      params: { limit },
    });
    return response.data?.data || [];
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || {
      message: "Error al obtener asistencias del cliente",
    };
  }
};

export const getRankingAsistencia = async (
  fechaDesde: string,
  fechaHasta: string,
  limit = 50
): Promise<RankingAsistenciaRow[]> => {
  try {
    const response = await api.get("/asistencia/ranking", {
      params: { fechaDesde, fechaHasta, limit },
    });
    return response.data?.data || [];
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || {
      message: "Error al obtener ranking de asistencia",
    };
  }
};
