import api from "./api";
import type { AxiosError } from "axios";
import type { PagoTipoCodigo } from "./cancha.service";

export interface CanchaCredito {
  CanchaCreditoId: number;
  CanchaReservaId: number;
  ClienteId: number;
  CanchaCreditoMonto: number;
  CanchaCreditoSaldo: number;
  CanchaCreditoFecha: string;
  CanchaCreditoPagoCant: number;
  UsuarioId?: string | null;
  // Datos embebidos del JOIN con cancha_reserva + cancha
  CanchaReservaFecha?: string;
  CanchaReservaHoraInicio?: string;
  CanchaReservaHoraFin?: string;
  CanchaId?: number;
  CanchaNombre?: string;
}

export const getCreditosPendientesPorCliente = async (
  clienteId: number
): Promise<{ data: CanchaCredito[] }> => {
  try {
    const r = await api.get(`/cancha-creditos/cliente/${clienteId}`);
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener créditos de cancha" };
  }
};

export interface CobrarCreditoPago {
  tipo: Exclude<PagoTipoCodigo, "CR">;
  monto: number;
}

export const cobrarCreditoCancha = async (
  creditoId: number,
  pagos: CobrarCreditoPago[]
) => {
  try {
    const r = await api.post(`/cancha-creditos/${creditoId}/cobrar`, { pagos });
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string; code?: string }>;
    throw ax.response?.data || { message: "Error al cobrar el crédito" };
  }
};
