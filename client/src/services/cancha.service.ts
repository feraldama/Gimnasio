import api from "./api";
import type { AxiosError } from "axios";

export interface Cancha {
  CanchaId: number;
  CanchaNombre: string;
  CanchaTarifaHora: number;
  CanchaActiva: number;
}

export interface CanchaReserva {
  CanchaReservaId: number;
  CanchaId: number;
  CanchaNombre?: string;
  ClienteId?: number | null;
  ClienteNombre?: string;
  ClienteApellido?: string;
  CanchaReservaCliente: string;
  CanchaReservaFecha: string;
  CanchaReservaHoraInicio: string;
  CanchaReservaHoraFin: string;
  CanchaReservaMonto: number;
  CanchaReservaEstado: "R" | "P" | "X" | string;
  CanchaReservaObservacion: string;
  UsuarioId?: string | null;
  CanchaReservaCreadoEn?: string;
}

// ---------- Canchas ----------
export const getCanchas = async (
  page = 1,
  limit = 50,
  sortBy?: string,
  sortOrder?: "asc" | "desc"
) => {
  const params: Record<string, string | number | undefined> = { page, limit };
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  try {
    const r = await api.get("/canchas", { params });
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener canchas" };
  }
};

export const getCanchasActivas = async (): Promise<{ data: Cancha[] }> => {
  try {
    const r = await api.get("/canchas/activas");
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener canchas" };
  }
};

export const createCancha = async (data: Partial<Cancha>) => {
  try {
    const r = await api.post("/canchas", data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al crear cancha" };
  }
};

export const updateCancha = async (id: number, data: Partial<Cancha>) => {
  try {
    const r = await api.put(`/canchas/${id}`, data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al actualizar cancha" };
  }
};

export const deleteCancha = async (id: number) => {
  try {
    const r = await api.delete(`/canchas/${id}`);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al eliminar cancha" };
  }
};

// ---------- Reservas ----------
export const getReservas = async (
  page = 1,
  limit = 20,
  sortBy?: string,
  sortOrder?: "asc" | "desc"
) => {
  const params: Record<string, string | number | undefined> = { page, limit };
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  try {
    const r = await api.get("/cancha-reservas", { params });
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener reservas" };
  }
};

export const searchReservas = async (
  q: string,
  page = 1,
  limit = 20
) => {
  try {
    const r = await api.get("/cancha-reservas/search", {
      params: { q, page, limit },
    });
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al buscar reservas" };
  }
};

export const getReservasPorFecha = async (fecha: string) => {
  try {
    const r = await api.get("/cancha-reservas/by-fecha", { params: { fecha } });
    return r.data as { data: CanchaReserva[] };
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener reservas" };
  }
};

export const createReserva = async (data: Partial<CanchaReserva>) => {
  try {
    const r = await api.post("/cancha-reservas", data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al crear reserva" };
  }
};

export const updateReserva = async (
  id: number,
  data: Partial<CanchaReserva>
) => {
  try {
    const r = await api.put(`/cancha-reservas/${id}`, data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al actualizar reserva" };
  }
};

export const deleteReserva = async (id: number) => {
  try {
    const r = await api.delete(`/cancha-reservas/${id}`);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al eliminar reserva" };
  }
};
