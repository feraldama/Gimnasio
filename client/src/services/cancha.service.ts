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

export const getReservasPorRango = async (desde: string, hasta: string) => {
  try {
    const r = await api.get("/cancha-reservas/by-rango", {
      params: { desde, hasta },
    });
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

// Códigos alineados con api/constants/pagoTipos.js. El backend valida y rechaza
// si llega algo distinto, por eso usamos un literal y no string libre.
export type PagoTipoCodigo = "CO" | "CR" | "PO" | "VO" | "TR";

export interface CobrarReservaPago {
  tipo: PagoTipoCodigo;
  monto: number;
}

export interface CobrarReservaResp {
  success: true;
  data: CanchaReserva;
  cobro: {
    totalPagado: number;
    efectivoSumadoACaja: number;
    cajaId: number;
  };
}

export const cobrarReserva = async (
  id: number,
  pagos: CobrarReservaPago[]
): Promise<CobrarReservaResp> => {
  try {
    const r = await api.post(`/cancha-reservas/${id}/cobrar`, { pagos });
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string; code?: string }>;
    throw ax.response?.data || { message: "Error al cobrar la reserva" };
  }
};

// ---------- Tarifas por banda ----------
export interface CanchaTarifa {
  CanchaTarifaId: number;
  CanchaId: number;
  CanchaTarifaNombre: string;
  CanchaTarifaDiasSemana: string;
  CanchaTarifaHoraDesde: string;
  CanchaTarifaHoraHasta: string;
  CanchaTarifaPrecio: number;
  CanchaTarifaPrioridad: number;
  CanchaTarifaActiva: number;
}

export const getTarifasByCancha = async (
  canchaId: number
): Promise<{ data: CanchaTarifa[] }> => {
  try {
    const r = await api.get(`/cancha-tarifas/cancha/${canchaId}`);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener tarifas" };
  }
};

export const createTarifa = async (data: Partial<CanchaTarifa>) => {
  try {
    const r = await api.post("/cancha-tarifas", data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al crear tarifa" };
  }
};

export const updateTarifa = async (
  id: number,
  data: Partial<CanchaTarifa>
) => {
  try {
    const r = await api.put(`/cancha-tarifas/${id}`, data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al actualizar tarifa" };
  }
};

export const deleteTarifa = async (id: number) => {
  try {
    const r = await api.delete(`/cancha-tarifas/${id}`);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al eliminar tarifa" };
  }
};

export interface SugerirMontoResp {
  monto: number;
  duracionHoras: number;
  banda: { CanchaTarifaId: number; nombre: string; precio: number } | null;
  fuente: "BANDA" | "FLAT_CANCHA" | "SIN_TARIFA";
}

export const sugerirMontoReserva = async (params: {
  canchaId: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
}): Promise<SugerirMontoResp> => {
  try {
    const r = await api.post("/cancha-tarifas/sugerir-monto", params);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al sugerir monto" };
  }
};
