import api from "./api";
import type { AxiosError } from "axios";

/**
 * Tablero mensual de administración.
 *
 * Base de medición: CAJA (lo cobrado), no lo facturado. La decisión está
 * documentada en api/utils/tablero.js — en resumen, los egresos sólo existen
 * en base caja, así que un resultado mezclando bases no significaría nada.
 *
 * Los campos de porcentaje son `number | null`. `null` significa "no se puede
 * calcular" y hay que mostrarlo como "—", nunca como 0:
 *   - `variacionPct` null → el mes anterior fue 0 (no existe % desde cero).
 *   - `cumplimientoPct` null → no hay meta cargada (meta 0 = sin meta).
 *   - `margenPct` null → no hubo ingresos.
 */

/** Bloque comparativo de una cifra: valor, mes anterior y meta. */
export interface BloqueComparativo {
  monto: number;
  mesAnterior: number;
  variacionPct: number | null;
  meta: number | null;
  cumplimientoPct: number | null;
}

export interface LineaNegocio extends BloqueComparativo {
  clave: "GIMNASIO" | "CANCHA" | "CANTINA";
  nombre: string;
  /** Saldo pendiente de cobro de esta línea. Es foto de HOY, no del mes. */
  porCobrar: number;
}

export interface EgresoCategoria {
  categoria: string;
  monto: number;
  mesAnterior: number;
  variacionPct: number | null;
}

export interface TableroMensualResponse {
  anio: number;
  mes: number;
  mesAnteriorRef: { anio: number; mes: number };
  base: "caja";
  lineas: LineaNegocio[];
  ingresos: BloqueComparativo;
  egresos: BloqueComparativo & { porCategoria: EgresoCategoria[] };
  resultado: BloqueComparativo & { margenPct: number | null };
  porCobrar: {
    gimnasio: number;
    cantina: number;
    cancha: number;
    total: number;
  };
}

export const getTableroMensual = async (
  anio: number,
  mes: number
): Promise<TableroMensualResponse> => {
  try {
    const response = await api.get("/tablero/mensual", {
      params: { anio, mes },
    });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string; error?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al obtener el tablero mensual",
      }
    );
  }
};

/** Cifra de crecimiento con su comparación contra el mes anterior. */
export interface CifraCrecimiento {
  cantidad: number;
  mesAnterior: number;
  variacionPct: number | null;
}

export interface CrecimientoResponse {
  anio: number;
  mes: number;
  mesAnteriorRef: { anio: number; mes: number };
  /** Días posteriores al vencimiento en que volver todavía cuenta como renovación. */
  diasGracia: number;
  /**
   * true mientras alguna suscripción vencida del mes siga dentro de su ventana
   * de gracia: todavía puede renovar y pasar de baja a retenida. Hay que
   * mostrarlo, o las bajas de un mes reciente se leen como definitivas.
   */
  provisorio: boolean;
  altas: CifraCrecimiento;
  renovaciones: CifraCrecimiento;
  bajas: CifraCrecimiento;
  retencion: {
    vencidas: number;
    retenidas: number;
    canceladas: number;
    /** null si no venció ninguna: no existe retener el 0% de nada. */
    tasaPct: number | null;
    tasaPctMesAnterior: number | null;
  };
  /**
   * Crecimiento real: variación del stock de socios con cobertura entre el
   * cierre de este mes y el del anterior. Negativo = el gimnasio se vacía.
   *
   * A propósito NO es altas − bajas. Altas y bajas son conteos de eventos que
   * no cierran contra el stock: un socio que se va en marzo y vuelve en junio
   * no es baja de marzo (su última cobertura termina en junio) ni alta de
   * junio (no es su primera).
   */
  variacionActivos: {
    cantidad: number;
    activosFinDeMes: number;
    activosFinMesAnterior: number;
  };
  activosFinDeMes: number;
}

export const getCrecimiento = async (
  anio: number,
  mes: number
): Promise<CrecimientoResponse> => {
  try {
    const response = await api.get("/tablero/crecimiento", {
      params: { anio, mes },
    });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string; error?: string }>;
    throw (
      axiosError.response?.data || {
        message: "Error al obtener el crecimiento de socios",
      }
    );
  }
};
