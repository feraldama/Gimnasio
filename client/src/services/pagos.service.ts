import api from "./api";
import type { AxiosError } from "axios";

export const getPagos = async (
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc"
) => {
  const params: { [key: string]: string | number | undefined } = {
    page,
    limit,
  };
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  try {
    const response = await api.get("/pagos", { params });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al obtener pagos" };
  }
};

export const getPagoById = async (id: string | number) => {
  try {
    const response = await api.get(`/pagos/${id}`);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al obtener pago" };
  }
};

export const createPago = async (pagoData: Record<string, unknown>) => {
  try {
    const response = await api.post("/pagos", pagoData);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al crear pago" };
  }
};

// Crea múltiples pagos (multi-método) atómicamente en el backend.
// Body: { pagos: [{PagoMonto, PagoTipo, PagoFecha?}, ...], SuscripcionId? | (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin) }
export const createPagoLote = async (loteData: Record<string, unknown>) => {
  try {
    const response = await api.post("/pagos/lote", loteData);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al crear lote de pagos" };
  }
};

export const updatePago = async (
  id: string | number,
  pagoData: Record<string, unknown>
) => {
  try {
    const response = await api.put(`/pagos/${id}`, pagoData);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al actualizar pago" };
  }
};

export const deletePago = async (id: string | number) => {
  try {
    const response = await api.delete(`/pagos/${id}`);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al eliminar pago" };
  }
};

export const getPagosByCliente = async (clienteId: string | number) => {
  try {
    const response = await api.get(`/pagos/cliente/${clienteId}`);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al obtener pagos del cliente",
      }
    );
  }
};

export const getReporteCobranza = async (
  fechaDesde: string,
  fechaHasta: string,
  agruparPor: "dia" | "semana" | "mes" = "dia"
) => {
  try {
    const response = await api.get("/pagos/reporte", {
      params: { fechaDesde, fechaHasta, agruparPor },
    });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al obtener el reporte de cobranza",
      }
    );
  }
};

export const searchPagos = async (
  searchTerm: string,
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc"
) => {
  const params: { [key: string]: string | number | undefined } = {
    q: searchTerm,
    page,
    limit,
  };
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  try {
    const response = await api.get("/pagos/search", { params });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw axiosError.response?.data || { message: "Error al buscar pagos" };
  }
};
