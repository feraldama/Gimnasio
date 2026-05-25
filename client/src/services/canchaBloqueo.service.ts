import api from "./api";
import type { AxiosError } from "axios";

export interface CanchaBloqueo {
  CanchaBloqueoId: number;
  CanchaId: number | null; // null = todas las canchas
  CanchaBloqueoFecha: string; // YYYY-MM-DD
  CanchaBloqueoHoraDesde: string | null; // HH:MM:SS o null = todo el día
  CanchaBloqueoHoraHasta: string | null;
  CanchaBloqueoMotivo: string;
  UsuarioId?: string | null;
  CanchaBloqueoCreadoEn?: string;
  // Embebido del JOIN con cancha
  CanchaNombre?: string;
}

export interface CanchaBloqueoInput {
  CanchaId?: number | null;
  CanchaBloqueoFecha: string;
  CanchaBloqueoHoraDesde?: string | null;
  CanchaBloqueoHoraHasta?: string | null;
  CanchaBloqueoMotivo?: string;
}

export const listBloqueos = async (
  desde: string,
  hasta: string
): Promise<{ data: CanchaBloqueo[] }> => {
  try {
    const r = await api.get("/cancha-bloqueos", { params: { desde, hasta } });
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener bloqueos" };
  }
};

export const createBloqueo = async (data: CanchaBloqueoInput) => {
  try {
    const r = await api.post("/cancha-bloqueos", data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al crear bloqueo" };
  }
};

export const updateBloqueo = async (
  id: number,
  data: Partial<CanchaBloqueoInput>
) => {
  try {
    const r = await api.put(`/cancha-bloqueos/${id}`, data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al actualizar bloqueo" };
  }
};

export const deleteBloqueo = async (id: number) => {
  try {
    const r = await api.delete(`/cancha-bloqueos/${id}`);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al eliminar bloqueo" };
  }
};
