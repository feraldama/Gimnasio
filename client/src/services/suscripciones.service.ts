import api from "./api";
import type { AxiosError } from "axios";

export const getSuscripciones = async (
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

export const getSuscripcionesProximasAVencer = async (
  dias = 30,
  limit?: number
) => {
  const params: { [key: string]: number } = { dias };
  if (limit != null && limit > 0) {
    params.limit = limit;
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
