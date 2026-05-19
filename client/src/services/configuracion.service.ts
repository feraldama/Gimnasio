import api from "./api";
import type { AxiosError } from "axios";

export interface ConfiguracionItem {
  ConfigClave: string;
  ConfigValor: string;
  ConfigDescripcion: string;
  ConfigTipo: "TEXTO" | "NUMERO" | "MONTO" | string;
}

export const getConfiguraciones = async (): Promise<{ data: ConfiguracionItem[] }> => {
  try {
    const r = await api.get("/configuracion");
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener configuracion" };
  }
};

export const getConfiguracion = async (clave: string): Promise<ConfiguracionItem> => {
  try {
    const r = await api.get(`/configuracion/${encodeURIComponent(clave)}`);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener configuracion" };
  }
};

export const upsertConfiguracion = async (data: ConfiguracionItem) => {
  try {
    const r = await api.post("/configuracion", data);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al guardar configuracion" };
  }
};

export const updateConfiguracion = async (
  clave: string,
  data: Partial<ConfiguracionItem>
) => {
  try {
    const r = await api.put(
      `/configuracion/${encodeURIComponent(clave)}`,
      data
    );
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al actualizar configuracion" };
  }
};
