import api from "./api";
import type { AxiosError } from "axios";

export const getSuscripciones = async (
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  estado?: string,
  pago?: string
) => {
  const params: { [key: string]: string | number | undefined } = {
    page,
    limit,
  };
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  if (estado) params.estado = estado;
  if (pago) params.pago = pago;
  try {
    const response = await api.get("/suscripciones", { params });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || { message: "Error al obtener suscripciones" }
    );
  }
};

export const getSuscripcionById = async (id: string | number) => {
  try {
    const response = await api.get(`/suscripciones/${id}`);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || { message: "Error al obtener suscripción" }
    );
  }
};

export const createSuscripcion = async (
  suscripcionData: Record<string, unknown>
) => {
  try {
    const response = await api.post("/suscripciones", suscripcionData);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || { message: "Error al crear suscripción" }
    );
  }
};

export const updateSuscripcion = async (
  id: string | number,
  suscripcionData: Record<string, unknown>
) => {
  try {
    const response = await api.put(`/suscripciones/${id}`, suscripcionData);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al actualizar suscripción",
      }
    );
  }
};

export const deleteSuscripcion = async (id: string | number) => {
  try {
    const response = await api.delete(`/suscripciones/${id}`);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || { message: "Error al eliminar suscripción" }
    );
  }
};

export const searchSuscripciones = async (
  searchTerm: string,
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  estado?: string,
  pago?: string
) => {
  const params: { [key: string]: string | number | undefined } = {
    q: searchTerm,
    page,
    limit,
  };
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  if (estado) params.estado = estado;
  if (pago) params.pago = pago;
  try {
    const response = await api.get("/suscripciones/search", { params });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || { message: "Error al buscar suscripciones" }
    );
  }
};

export const getAllSuscripcionesSinPaginacion = async () => {
  try {
    const response = await api.get("/suscripciones/sin-paginacion");
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al obtener suscripciones",
      }
    );
  }
};

export const getSuscripcionesByCliente = async (clienteId: string | number) => {
  try {
    const response = await api.get(`/suscripciones/cliente/${clienteId}`);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al obtener suscripciones del cliente",
      }
    );
  }
};

/**
 * Fila de la lista de trabajo de vencimientos. Los campos de contacto,
 * saldo y asistencia son los que la vuelven accionable: sin teléfono no se
 * puede llamar, y sin la última asistencia no se sabe si el socio se olvidó
 * de pagar o ya se fue.
 */
export interface SuscripcionPorVencer {
  SuscripcionId: number;
  ClienteId: number;
  PlanId?: number;
  ClienteNombre?: string;
  ClienteApellido?: string;
  /** Puede venir vacío: el cliente existe pero no tiene el dato cargado. */
  ClienteTelefono?: string;
  ClienteRUC?: string;
  PlanNombre?: string;
  PlanPrecio?: number;
  PlanModalidad?: string;
  PlanCantidadClases?: number;
  SuscripcionFechaInicio?: string;
  SuscripcionFechaFin: string;
  SuscripcionClasesRestantes?: number;
  SuscripcionEstado?: string;
  EstadoPago?: "PAGADA" | "PENDIENTE";
  /** Lo que falta cobrar de este plan, en guaraníes. */
  SaldoPendiente?: number;
  /** null si el socio nunca registró una asistencia. */
  UltimaAsistencia?: string | null;
  /** null si nunca vino. 0 = vino hoy. */
  DiasSinVenir?: number | null;
  /** Por qué está en la lista. VENCIDA es la más urgente. */
  Motivo?: "VENCIDA" | "VENCE" | "CLASES";
  [key: string]: unknown;
}

export interface ProximasAVencerResponse {
  data: SuscripcionPorVencer[];
  dias: number;
  clasesMin: number;
  diasVencidos: number;
}

export const getSuscripcionesProximasAVencer = async (
  dias = 30,
  limit?: number,
  clasesMin?: number,
  diasVencidos?: number
) => {
  const params: { [key: string]: number } = { dias };
  if (limit != null && limit > 0) {
    params.limit = limit;
  }
  if (clasesMin != null && clasesMin >= 0) {
    params.clasesMin = clasesMin;
  }
  if (diasVencidos != null && diasVencidos >= 0) {
    params.diasVencidos = diasVencidos;
  }
  try {
    const response = await api.get("/suscripciones/proximas-a-vencer", {
      params,
    });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al obtener suscripciones próximas a vencer",
      }
    );
  }
};
