import api from "./api";
import type { AxiosError } from "axios";

/**
 * Ventas y cobros de gimnasio cargados en el día (solo lectura).
 *
 * El backend fija el alcance: un cajero ve sólo HOY y sólo su local; el admin
 * puede pedir otra fecha u otro local. Ver api/utils/movimientosDia.js.
 */

export interface MovimientoVentaItem {
  VentaId: number;
  ProductoId: number;
  ProductoNombre: string | null;
  VentaProductoCantidad: number;
  /** "U" = unidades sueltas, "C" = cajas. */
  VentaProductoUnitario: string;
  VentaProductoPrecioTotal: number;
}

/** Movimiento de caja de una venta: dice el medio de cobro y la caja. */
export interface MovimientoVentaCaja {
  VentaId: number;
  TipoGastoGrupoId: number;
  RegistroDiarioCajaMonto: number;
  CajaId: number;
  CajaDescripcion: string | null;
}

export interface MovimientoVenta {
  VentaId: number;
  VentaFecha: string;
  VentaTipo: string;
  Total: number;
  VentaEntrega: number;
  AlmacenId: number;
  VentaUsuario: string;
  UsuarioNombre: string | null;
  ClienteNombre: string | null;
  ClienteApellido: string | null;
  Items: MovimientoVentaItem[];
  Movimientos: MovimientoVentaCaja[];
}

export interface MovimientoPago {
  PagoId: number;
  PagoFecha: string;
  PagoMonto: number;
  PagoTipo: string;
  PagoUsuarioId: string;
  UsuarioNombre: string | null;
  SuscripcionId: number;
  PlanNombre: string | null;
  ClienteNombre: string | null;
  ClienteApellido: string | null;
  /** null = el pago no dejó movimiento de caja (se cobró con la caja cerrada). */
  CajaId: number | null;
  CajaDescripcion: string | null;
}

export interface MovimientosDia {
  fecha: string;
  /** null = todos los locales. */
  localId: number | null;
  puedeElegirFecha: boolean;
  ventas: MovimientoVenta[];
  pagos: MovimientoPago[];
}

export const getMovimientosDia = async (params?: {
  fecha?: string;
  localId?: number;
}): Promise<MovimientosDia> => {
  try {
    const r = await api.get("/movimientos-dia", { params });
    return r.data;
  } catch (e) {
    const ax = e as AxiosError<{ message?: string }>;
    throw ax.response?.data || { message: "Error al obtener los movimientos del día" };
  }
};
