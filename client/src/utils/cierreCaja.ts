// Armado de turnos de caja (apertura → cierre) y sus totales.
//
// Vivía dentro de ReportesPage; se movió acá porque la pantalla de corrección
// de caja necesita exactamente el mismo cálculo para mostrar cómo queda la
// diferencia del turno antes y después de corregir.
//
// QUÉ MOVIMIENTOS SON DE UN TURNO
// No hay entidad "turno": cada apertura y cada cierre deja una fila en
// `registrodiariocaja` y el turno es lo que queda entre las dos, por id, para
// la misma caja y el mismo usuario.
// Excepción (migración 023): una corrección que carga un movimiento en un turno
// ya cerrado no puede quedar dentro del rango de ids (su id es mayor que el del
// cierre), así que lleva `AperturaRef` = id de la apertura del turno. Un
// movimiento con AperturaRef pertenece a ESE turno y a ningún otro. La misma
// regla está en api/utils/turnoCaja.js.
import type { RegistroDiarioCajaRow } from "../services/registros.service";
import { controlEfectivo, type ControlEfectivo } from "./cajaOrigen";

export interface ResumenCierre {
  fechaCierre: string;
  fechaCierreDate: Date;
  aperturaId: number;
  cierreId: number;
  cajaId: number;
  cajaDescripcion: string;
  /** Local de la caja (caja.LocalId); 0 = sin local. */
  localId: number;
  usuarioId: string;
  apertura: number;
  cierre: number;
  egresos: number;
  ingresos: number;
  ingresosPOS: number;
  ingresosVoucher: number;
  ingresosTransfer: number;
  totalIngresos: number;
  diferencia: number;
  sobranteFaltante: number;
  control: ControlEfectivo;
  parcial?: boolean;
}

export function toLocalDateStr(fechaRegistro: string): string {
  const d = new Date(fechaRegistro);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateDDMMYYYY(fecha: Date | string): string {
  const d =
    typeof fecha === "string"
      ? new Date(fecha.includes("T") ? fecha : fecha + "T12:00:00")
      : fecha;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * ¿El movimiento es del turno que abre `idApertura` y cierra `idCierre`?
 * Para un turno abierto pasar `idCierre = Infinity`.
 * Se asume que `r` ya es de la misma caja y usuario que el turno.
 */
export function perteneceAlTurno(
  r: Pick<RegistroDiarioCajaRow, "RegistroDiarioCajaId" | "AperturaRef">,
  idApertura: number,
  idCierre: number,
): boolean {
  if (r.AperturaRef != null) return Number(r.AperturaRef) === idApertura;
  return (
    r.RegistroDiarioCajaId >= idApertura && r.RegistroDiarioCajaId <= idCierre
  );
}

export function calcularTotalesCiclo(
  registrosCajaUsuario: RegistroDiarioCajaRow[],
  idApertura: number,
  idCierre: number,
) {
  const filtrados = registrosCajaUsuario.filter((r) =>
    perteneceAlTurno(r, idApertura, idCierre),
  );
  const aperturaReg = filtrados.find(
    (r) => r.TipoGastoId === 2 && r.TipoGastoGrupoId === 2,
  );
  const cierreReg = filtrados.find(
    (r) => r.TipoGastoId === 1 && r.TipoGastoGrupoId === 2,
  );
  const apertura = aperturaReg?.RegistroDiarioCajaMonto ?? 0;
  const cierre = cierreReg?.RegistroDiarioCajaMonto ?? 0;

  let egresos = 0;
  let ingresos = 0;
  let ingresosPOS = 0;
  let ingresosVoucher = 0;
  let ingresosTransfer = 0;
  for (const reg of filtrados) {
    if (
      reg.TipoGastoId === 2 &&
      reg.TipoGastoGrupoId !== 2 &&
      reg.TipoGastoGrupoId !== 4 &&
      reg.TipoGastoGrupoId !== 5 &&
      reg.TipoGastoGrupoId !== 6
    ) {
      ingresos += reg.RegistroDiarioCajaMonto;
    }
    if (reg.TipoGastoId === 1 && reg.TipoGastoGrupoId !== 2) {
      egresos += reg.RegistroDiarioCajaMonto;
    }
    if (reg.TipoGastoId === 2 && reg.TipoGastoGrupoId === 4) {
      ingresosPOS += reg.RegistroDiarioCajaMonto;
    }
    if (reg.TipoGastoId === 2 && reg.TipoGastoGrupoId === 5) {
      ingresosVoucher += reg.RegistroDiarioCajaMonto;
    }
    if (reg.TipoGastoId === 2 && reg.TipoGastoGrupoId === 6) {
      ingresosTransfer += reg.RegistroDiarioCajaMonto;
    }
  }
  const totalIngresos =
    ingresos + ingresosPOS + ingresosVoucher + ingresosTransfer;
  const diferencia = totalIngresos - egresos;
  const sobranteFaltante = ingresos + apertura - (cierre + egresos);
  // Movimientos que componen el efectivo esperado, por origen, para poder
  // buscar dónde está el sobrante/faltante.
  const control = controlEfectivo(filtrados, apertura, cierre);

  return {
    control,
    apertura,
    cierre,
    egresos,
    ingresos,
    ingresosPOS,
    ingresosVoucher,
    ingresosTransfer,
    totalIngresos,
    diferencia,
    sobranteFaltante,
  };
}

export function buildResumenesCierre(
  registros: RegistroDiarioCajaRow[],
  fechaDesde: string,
  fechaHasta: string,
): ResumenCierre[] {
  if (registros.length === 0) return [];

  const cierres = registros
    .filter((r) => r.TipoGastoId === 1 && r.TipoGastoGrupoId === 2)
    .sort((a, b) => a.RegistroDiarioCajaId - b.RegistroDiarioCajaId);

  const resumenes: ResumenCierre[] = [];

  for (const cierreReg of cierres) {
    const fechaCierreLocal = toLocalDateStr(cierreReg.RegistroDiarioCajaFecha);
    if (fechaCierreLocal < fechaDesde || fechaCierreLocal > fechaHasta)
      continue;
    const registrosCajaUsuario = registros.filter(
      (r) =>
        r.CajaId === cierreReg.CajaId && r.UsuarioId === cierreReg.UsuarioId,
    );
    const mismosCajaUsuarioHastaCierre = registrosCajaUsuario.filter(
      (r) => r.RegistroDiarioCajaId <= cierreReg.RegistroDiarioCajaId,
    );
    const aperturas = mismosCajaUsuarioHastaCierre
      .filter(
        (r) =>
          r.TipoGastoId === 2 &&
          r.TipoGastoGrupoId === 2 &&
          r.RegistroDiarioCajaId < cierreReg.RegistroDiarioCajaId,
      )
      .sort((a, b) => b.RegistroDiarioCajaId - a.RegistroDiarioCajaId);
    const aperturaReg = aperturas[0];
    if (!aperturaReg) continue;
    if (cierreReg.RegistroDiarioCajaId <= aperturaReg.RegistroDiarioCajaId)
      continue;

    const totals = calcularTotalesCiclo(
      registrosCajaUsuario,
      aperturaReg.RegistroDiarioCajaId,
      cierreReg.RegistroDiarioCajaId,
    );

    const fechaCierreDate = new Date(cierreReg.RegistroDiarioCajaFecha);
    resumenes.push({
      fechaCierre: formatDateDDMMYYYY(fechaCierreDate),
      fechaCierreDate,
      aperturaId: aperturaReg.RegistroDiarioCajaId,
      cierreId: cierreReg.RegistroDiarioCajaId,
      cajaId: cierreReg.CajaId,
      cajaDescripcion: cierreReg.CajaDescripcion ?? `Caja ${cierreReg.CajaId}`,
      localId: Number(cierreReg.LocalId) || 0,
      usuarioId: cierreReg.UsuarioId,
      ...totals,
    });
  }

  resumenes.sort(
    (a, b) => a.fechaCierreDate.getTime() - b.fechaCierreDate.getTime(),
  );
  return resumenes;
}
