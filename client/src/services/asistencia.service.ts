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
    PlanId: number;
    PlanNombre: string;
    PlanPermiteClases: number | boolean;
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
