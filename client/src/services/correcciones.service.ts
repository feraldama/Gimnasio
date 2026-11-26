import api from "./api";
import type { AxiosError } from "axios";
import type { RegistroDiarioCajaRow } from "./registros.service";

/**
 * Corrección de caja: corrige ventas y cobros sobre su turno original sin
 * tocar la caja abierta de hoy. Reglas en api/models/correccionCaja.model.js.
 */

export type Medio = "EFECTIVO" | "POS" | "VOUCHER" | "TRANSFERENCIA";

export interface RegistroTurno extends RegistroDiarioCajaRow {
  UsuarioNombre?: string | null;
}

export interface TurnosResponse {
  fecha: string;
  registros: RegistroTurno[];
  correcciones: { AperturaId: number; cantidad: number }[];
  esSupervisor: boolean;
  puedeEditarPropio: boolean;
  plazoDias: number;
  usuarioId: string;
}

export interface VentaTurno {
  VentaId: number;
  VentaFecha: string;
  VentaTipo: string;
  Total: number;
  VentaEntrega: number;
  AlmacenId: number;
  ClienteNombre: string | null;
  ClienteApellido: string | null;
  Items: {
    VentaId: number;
    ProductoId: number;
    ProductoNombre: string | null;
    VentaProductoCantidad: number;
    VentaProductoPrecioTotal: number;
  }[];
}

export interface PagoTurno {
  PagoId: number;
  PagoTipo: string;
  PagoMonto: number;
  SuscripcionId: number;
  PlanNombre: string | null;
  ClienteNombre: string | null;
  ClienteApellido: string | null;
}

export interface CorreccionRegistrada {
  CorreccionCajaId: number;
  CorreccionCajaFecha: string;
  UsuarioId: string;
  UsuarioNombre: string | null;
  /** REGISTRO = movimiento editado/borrado desde Registro Diario Caja. */
  CorreccionCajaEntidad: "VENTA" | "PAGO" | "REGISTRO";
  CorreccionCajaEntidadId: number;
  CorreccionCajaAccion: "METODO" | "ANULAR" | "CARGAR" | "EDITAR" | "ELIMINAR";
  CorreccionCajaMotivo: string;
  CorreccionCajaAntes: Record<string, unknown> | null;
  CorreccionCajaDespues: Record<string, unknown> | null;
}

export interface TurnoDetalle {
  turno: {
    aperturaId: number;
    cierreId: number | null;
    abierto: boolean;
    cajaId: number;
    cajaDescripcion: string | null;
    localId: number;
    usuarioId: string;
    usuarioNombre: string | null;
    aperturaFecha: string;
    cierreFecha: string | null;
  };
  registros: RegistroTurno[];
  ventas: VentaTurno[];
  pagos: PagoTurno[];
  correcciones: CorreccionRegistrada[];
  puedeCorregir: boolean;
  motivoNoCorregible: string | null;
  esSupervisor: boolean;
  /** Tipos de egreso (TipoGastoId 1, sin apertura/cierre) para cargar uno faltante. */
  gruposEgreso?: { TipoGastoGrupoId: number; TipoGastoGrupoDescripcion: string }[];
}

export interface EgresoFaltanteInput {
  motivo: string;
  TipoGastoGrupoId: number;
  RegistroDiarioCajaMonto: number;
  RegistroDiarioCajaDetalle?: string;
}

export interface VentaFaltanteInput {
  motivo: string;
  ClienteId?: number;
  Productos: {
    ProductoId: number;
    VentaProductoCantidad: number;
    VentaProductoPrecioTotal: number;
    ProductoUnidad: "U" | "C";
  }[];
  Pagos: {
    Efectivo?: number;
    Banco?: number;
    Voucher?: number;
    Transferencia?: number;
  };
}

function lanzar(e: unknown, porDefecto: string): never {
  const ax = e as AxiosError<{ message?: string }>;
  throw ax.response?.data || { message: porDefecto };
}

export const getTurnosParaCorreccion = async (fecha: string): Promise<TurnosResponse> => {
  try {
    const r = await api.get("/correcciones/turnos", { params: { fecha } });
    return r.data;
  } catch (e) {
    lanzar(e, "Error al obtener los turnos");
  }
};

export const getTurnoParaCorreccion = async (aperturaId: number): Promise<TurnoDetalle> => {
  try {
    const r = await api.get(`/correcciones/turno/${aperturaId}`);
    return r.data;
  } catch (e) {
    lanzar(e, "Error al obtener el turno");
  }
};

export interface TicketTurno {
  turno: {
    aperturaId: number;
    cierreId: number;
    cajaId: number;
    cajaDescripcion: string | null;
    usuarioId: string;
    usuarioNombre: string | null;
    aperturaFecha: string;
    cierreFecha: string;
  };
  registros: RegistroTurno[];
  correccionesPosteriores: number;
  /** Sobrante/faltante del ticket original (> 0 faltante). */
  diferenciaAlCerrar: number;
  /** true = lo guardó el cierre; false = reconstruido (cierres viejos). */
  guardadoAlCerrar: boolean;
}

export const getTicketTurno = async (aperturaId: number): Promise<TicketTurno> => {
  try {
    const r = await api.get(`/correcciones/turno/${aperturaId}/ticket`);
    return r.data;
  } catch (e) {
    lanzar(e, "No se pudo obtener el ticket del turno");
  }
};

export const cambiarMedioMovimiento = async (
  registroId: number,
  medio: Medio,
  motivo: string
) => {
  try {
    const r = await api.post(`/correcciones/movimiento/${registroId}/medio`, {
      medio,
      motivo,
    });
    return r.data;
  } catch (e) {
    lanzar(e, "No se pudo cambiar el medio de cobro");
  }
};

export const anularVentaCorreccion = async (ventaId: number, motivo: string) => {
  try {
    const r = await api.post(`/correcciones/venta/${ventaId}/anular`, { motivo });
    return r.data;
  } catch (e) {
    lanzar(e, "No se pudo anular la venta");
  }
};

export const cargarVentaFaltante = async (
  aperturaId: number,
  data: VentaFaltanteInput
) => {
  try {
    const r = await api.post(`/correcciones/turno/${aperturaId}/venta`, data);
    return r.data;
  } catch (e) {
    lanzar(e, "No se pudo cargar la venta");
  }
};

export const cargarEgresoFaltante = async (
  aperturaId: number,
  data: EgresoFaltanteInput
) => {
  try {
    const r = await api.post(`/correcciones/turno/${aperturaId}/egreso`, data);
    return r.data;
  } catch (e) {
    lanzar(e, "No se pudo cargar el egreso");
  }
};
