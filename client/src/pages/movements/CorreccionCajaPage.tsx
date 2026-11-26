import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Swal from "sweetalert2";
import {
  ArrowsRightLeftIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  PlusIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,
  TextInput,
} from "../../components/common/ui";
import { usePermiso } from "../../hooks/usePermiso";
import BotonTicketCierre from "../../components/common/Button/BotonTicketCierre";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  anularVentaCorreccion,
  cambiarMedioMovimiento,
  cargarEgresoFaltante,
  cargarVentaFaltante,
  getTurnoParaCorreccion,
  getTurnosParaCorreccion,
  type CorreccionRegistrada,
  type Medio,
  type RegistroTurno,
  type TurnoDetalle,
  type TurnosResponse,
  type VentaTurno,
} from "../../services/correcciones.service";
import { getProductosAll } from "../../services/productos.service";
import {
  buildResumenesCierre,
  calcularTotalesCiclo,
  toLocalDateStr,
} from "../../utils/cierreCaja";
import { addDaysLocal, formatDateLocal, formatMiles, todayLocalISO } from "../../utils/utils";

/**
 * Corrección de caja.
 *
 * El cliente hace el control del cierre al día siguiente y encuentra que un
 * cobro se cargó como transferencia y era efectivo, una venta quedó duplicada,
 * un producto nunca se cargó o se pagó un gasto con plata del cajón sin
 * registrarlo. Esta pantalla corrige esos movimientos SOBRE
 * SU TURNO ORIGINAL: el cierre de ayer queda cuadrado y la caja abierta hoy no
 * se toca. Cada corrección pide motivo y queda registrada.
 *
 * Permisos (CORRECCIONCAJA): editar = el cajero corrige su turno abierto;
 * eliminar = supervisor, corrige turnos cerrados dentro del plazo.
 */

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
type TipoMov = "VENTA" | "COBRO_CREDITO" | "PAGO";

const MEDIOS: { key: Medio; label: string; grupo: number; tone: Tone }[] = [
  { key: "EFECTIVO", label: "Efectivo", grupo: 1, tone: "success" },
  { key: "POS", label: "POS", grupo: 4, tone: "info" },
  { key: "TRANSFERENCIA", label: "Transferencia", grupo: 6, tone: "brand" },
  { key: "VOUCHER", label: "Voucher", grupo: 5, tone: "neutral" },
];

function medioDeGrupo(grupo: number) {
  if (grupo === 1 || grupo === 3) return MEDIOS[0];
  return MEDIOS.find((m) => m.grupo === grupo) || null;
}

function clasificar(r: RegistroTurno): TipoMov | null {
  if (r.TipoGastoId !== 2 || r.TipoGastoGrupoId === 2) return null;
  if (r.PagoId != null) return "PAGO";
  if (r.VentaId != null) {
    return (r.RegistroDiarioCajaDetalle || "").startsWith("Cobro Crédito")
      ? "COBRO_CREDITO"
      : "VENTA";
  }
  return null;
}

// Los cobros de gimnasio se guardan con fecha sin hora (medianoche): mostrar
// "12:00 a. m." sería una hora inventada, así que va "—".
const hora = (f?: string | null) => {
  if (!f) return "";
  const d = new Date(f);
  if (isNaN(d.getTime())) return "";
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return "—";
  return d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
};

const nombre = (n?: string | null, a?: string | null) =>
  [n, a].filter((x) => x && String(x).trim()).join(" ").trim();

/** Diferencia de efectivo del turno: > 0 faltante, < 0 sobrante. */
function diferenciaTurno(registros: RegistroTurno[], aperturaId: number, cierreId: number | null) {
  return calcularTotalesCiclo(registros, aperturaId, cierreId ?? Infinity).control;
}

function Diferencia({ valor, abierto }: { valor: number; abierto?: boolean }) {
  if (abierto) return <Badge tone="info">Turno abierto</Badge>;
  if (valor === 0) return <Badge tone="success">Cuadra</Badge>;
  return valor > 0 ? (
    <Badge tone="danger">Faltante Gs. {formatMiles(valor)}</Badge>
  ) : (
    <Badge tone="warning">Sobrante Gs. {formatMiles(Math.abs(valor))}</Badge>
  );
}

interface TurnoResumen {
  aperturaId: number;
  cierreId: number | null;
  abierto: boolean;
  cajaDescripcion: string;
  usuario: string;
  aperturaFecha: string;
  cierreFecha: string | null;
  diferencia: number;
  correcciones: number;
}

/** Turnos de la fecha: los cerrados ese día y los que siguen abiertos. */
function armarTurnos(data: TurnosResponse): TurnoResumen[] {
  const { registros, fecha } = data;
  const nombres = new Map(registros.map((r) => [r.UsuarioId, r.UsuarioNombre || r.UsuarioId]));
  const fechaReg = new Map(registros.map((r) => [r.RegistroDiarioCajaId, r.RegistroDiarioCajaFecha]));
  const corr = new Map(data.correcciones.map((c) => [Number(c.AperturaId), Number(c.cantidad)]));

  const cerrados: TurnoResumen[] = buildResumenesCierre(registros, fecha, fecha).map((t) => ({
    aperturaId: t.aperturaId,
    cierreId: t.cierreId,
    abierto: false,
    cajaDescripcion: t.cajaDescripcion,
    usuario: String(nombres.get(t.usuarioId) || t.usuarioId),
    aperturaFecha: fechaReg.get(t.aperturaId) || "",
    cierreFecha: fechaReg.get(t.cierreId) || null,
    diferencia: t.control.diferencia,
    correcciones: corr.get(t.aperturaId) || 0,
  }));

  const abiertos: TurnoResumen[] = registros
    .filter((a) => a.TipoGastoId === 2 && a.TipoGastoGrupoId === 2)
    .filter(
      (a) =>
        !registros.some(
          (c) =>
            c.TipoGastoId === 1 &&
            c.TipoGastoGrupoId === 2 &&
            c.CajaId === a.CajaId &&
            c.UsuarioId === a.UsuarioId &&
            c.RegistroDiarioCajaId > a.RegistroDiarioCajaId,
        ),
    )
    .filter((a) => toLocalDateStr(a.RegistroDiarioCajaFecha) <= fecha)
    .map((a) => ({
      aperturaId: a.RegistroDiarioCajaId,
      cierreId: null,
      abierto: true,
      cajaDescripcion: a.CajaDescripcion || `Caja ${a.CajaId}`,
      usuario: String(nombres.get(a.UsuarioId) || a.UsuarioId),
      aperturaFecha: a.RegistroDiarioCajaFecha,
      cierreFecha: null,
      diferencia: 0,
      correcciones: corr.get(a.RegistroDiarioCajaId) || 0,
    }));

  return [...abiertos, ...cerrados];
}

export default function CorreccionCajaPage() {
  // Los tres hooks se llaman siempre (nada de `||` entre llamadas a hooks).
  const permLeer = usePermiso("CORRECCIONCAJA", "leer");
  const permEditar = usePermiso("CORRECCIONCAJA", "editar");
  const permEliminar = usePermiso("CORRECCIONCAJA", "eliminar");
  const puedeLeer = permLeer || permEditar || permEliminar;

  const [fecha, setFecha] = useState(addDaysLocal(todayLocalISO(), -1));
  const [turnosData, setTurnosData] = useState<TurnosResponse | null>(null);
  const [cargandoTurnos, setCargandoTurnos] = useState(false);
  const [errorTurnos, setErrorTurnos] = useState<string | null>(null);
  const [aperturaSel, setAperturaSel] = useState<number | null>(null);

  const cargarTurnos = useCallback(async () => {
    if (!puedeLeer) return;
    setCargandoTurnos(true);
    setErrorTurnos(null);
    try {
      setTurnosData(await getTurnosParaCorreccion(fecha));
    } catch (e) {
      setErrorTurnos((e as { message?: string }).message || "Error al cargar los turnos");
    } finally {
      setCargandoTurnos(false);
    }
  }, [fecha, puedeLeer]);

  useEffect(() => {
    cargarTurnos();
    setAperturaSel(null);
  }, [cargarTurnos]);

  const turnos = useMemo(() => (turnosData ? armarTurnos(turnosData) : []), [turnosData]);

  if (!puedeLeer) return <PermissionDenied resource="la corrección de caja" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-strong">Corrección de caja</h1>
          <p className="max-w-2xl text-sm text-text-muted">
            Corregí ventas y cobros sobre su turno original: el cierre de ese
            turno queda cuadrado y la caja abierta hoy no se toca.
            {turnosData &&
              (turnosData.esSupervisor
                ? ` Los turnos cerrados se pueden corregir hasta ${turnosData.plazoDias} días después del cierre.`
                : " Podés corregir los movimientos de tu turno abierto; los turnos cerrados los corrige un supervisor.")}
          </p>
        </div>
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Fecha del cierre
          <input
            type="date"
            value={fecha}
            max={todayLocalISO()}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
            className="mt-1 block rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
          />
        </label>
      </div>

      <Card padding="none">
        <div className="p-5">
          <CardHeader
            title={`Turnos del ${formatDateLocal(fecha)}`}
            description="Elegí el turno que no cuadró."
          />
        </div>
        {cargandoTurnos && <LoadingState message="Cargando turnos…" />}
        {!cargandoTurnos && errorTurnos && (
          <ErrorState message={errorTurnos} onRetry={cargarTurnos} />
        )}
        {!cargandoTurnos && !errorTurnos && turnos.length === 0 && (
          <EmptyState
            title="No hay turnos"
            description="No se cerró ningún turno en esa fecha."
          />
        )}
        {!cargandoTurnos && !errorTurnos && turnos.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {turnos.map((t) => {
              const activo = t.aperturaId === aperturaSel;
              return (
                <li
                  key={t.aperturaId}
                  className={`flex items-center gap-2 pr-5 transition-colors hover:bg-surface-sunken ${
                    activo ? "bg-brand-50" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setAperturaSel(activo ? null : t.aperturaId)}
                    aria-expanded={activo}
                    className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 py-3 pl-5 text-left"
                  >
                    <div>
                      <div className="font-medium text-text">
                        {t.cajaDescripcion} · {t.usuario}
                      </div>
                      <div className="text-xs text-text-muted">
                        {hora(t.aperturaFecha)} → {t.abierto ? "abierto" : hora(t.cierreFecha)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.correcciones > 0 && (
                        <Badge tone="neutral">
                          {t.correcciones} correcci{t.correcciones === 1 ? "ón" : "ones"}
                        </Badge>
                      )}
                      <Diferencia valor={t.diferencia} abierto={t.abierto} />
                    </div>
                  </button>
                  {!t.abierto && <BotonTicketCierre aperturaId={t.aperturaId} compacto />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {aperturaSel != null && (
        <DetalleTurno
          key={aperturaSel}
          aperturaId={aperturaSel}
          onCambio={cargarTurnos}
        />
      )}
    </div>
  );
}

type Accion =
  | { tipo: "medio"; registro: RegistroTurno; tipoMov: TipoMov }
  | { tipo: "anular"; venta: VentaTurno }
  | { tipo: "cargar" }
  | { tipo: "egreso" };

function DetalleTurno({ aperturaId, onCambio }: { aperturaId: number; onCambio: () => void }) {
  const [data, setData] = useState<TurnoDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getTurnoParaCorreccion(aperturaId));
    } catch (e) {
      setError((e as { message?: string }).message || "Error al cargar el turno");
    } finally {
      setLoading(false);
    }
  }, [aperturaId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const despuesDeCorregir = async (mensaje: string) => {
    setAccion(null);
    await cargar();
    onCambio();
    Swal.fire({ icon: "success", title: mensaje, timer: 1800, showConfirmButton: false });
  };

  if (loading && !data) return <LoadingState message="Cargando turno…" />;
  if (error) return <ErrorState message={error} onRetry={cargar} />;
  if (!data) return null;

  const { turno, registros } = data;
  const control = diferenciaTurno(registros, turno.aperturaId, turno.cierreId);
  const ventas = new Map(data.ventas.map((v) => [v.VentaId, v]));
  const pagos = new Map(data.pagos.map((p) => [p.PagoId, p]));
  const movimientos = registros.filter((r) => r.TipoGastoGrupoId !== 2);

  const descripcion = (r: RegistroTurno): ReactNode => {
    const tipo = clasificar(r);
    if (tipo === "PAGO") {
      const p = pagos.get(Number(r.PagoId));
      return (
        <>
          <div className="font-medium text-text">
            {nombre(p?.ClienteNombre, p?.ClienteApellido) || "Socio"}
          </div>
          <div className="text-xs text-text-muted">
            Cobro gimnasio · {p?.PlanNombre || `suscripción #${p?.SuscripcionId ?? "?"}`}
          </div>
        </>
      );
    }
    if (tipo === "VENTA" || tipo === "COBRO_CREDITO") {
      const v = ventas.get(Number(r.VentaId));
      return (
        <>
          <div className="font-medium text-text">
            {v?.Items.map((i) => `${i.VentaProductoCantidad} × ${i.ProductoNombre}`).join(", ") ||
              `Venta N° ${r.VentaId}`}
          </div>
          <div className="text-xs text-text-muted">
            {tipo === "COBRO_CREDITO" ? "Cobro de crédito" : "Venta"} N° {r.VentaId}
            {r.AperturaRef != null && " · cargada por corrección"}
          </div>
        </>
      );
    }
    return <div className="text-text-muted">{r.RegistroDiarioCajaDetalle}</div>;
  };

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <CardHeader
          title={`${turno.cajaDescripcion || `Caja ${turno.cajaId}`} · ${turno.usuarioNombre || turno.usuarioId}`}
          description={
            turno.abierto
              ? `Abierto desde las ${hora(turno.aperturaFecha)}. Los cambios en efectivo ajustan el cajón actual.`
              : `Del ${formatDateLocal(turno.aperturaFecha)} ${hora(turno.aperturaFecha)} al cierre de las ${hora(turno.cierreFecha)}. El cajón ya se rindió: corregir no mueve la caja de hoy.`
          }
        />
        <div className="text-right">
          {!turno.abierto && (
            <div className="mb-1 text-xs text-text-muted">
              Esperado Gs. {formatMiles(control.esperado)} · declarado Gs.{" "}
              {formatMiles(control.declarado)}
            </div>
          )}
          <Diferencia valor={control.diferencia} abierto={turno.abierto} />
        </div>
      </div>

      {!data.puedeCorregir && data.motivoNoCorregible && (
        <div className="mx-5 mb-4 rounded-md border border-warning-200 bg-warning-50 px-4 py-2 text-sm text-warning-700">
          {data.motivoNoCorregible}
        </div>
      )}

      {data.puedeCorregir && !turno.abierto && (
        <div className="flex flex-wrap justify-end gap-2 px-5 pb-4">
          <Button variant="secondary" leftIcon={ArrowUpTrayIcon} onClick={() => setAccion({ tipo: "egreso" })}>
            Cargar egreso que faltó
          </Button>
          <Button variant="secondary" leftIcon={PlusIcon} onClick={() => setAccion({ tipo: "cargar" })}>
            Cargar venta que faltó
          </Button>
        </div>
      )}

      {movimientos.length === 0 ? (
        <EmptyState title="Sin movimientos" description="El turno no tiene ventas, cobros ni egresos." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border bg-surface-sunken text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-2 font-semibold">Hora</th>
                <th className="px-4 py-2 font-semibold">Movimiento</th>
                <th className="px-4 py-2 font-semibold">Medio</th>
                <th className="px-4 py-2 text-right font-semibold">Monto</th>
                <th className="px-4 py-2 text-right font-semibold">Corregir</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((r) => {
                const tipo = clasificar(r);
                const egreso = r.TipoGastoId === 1;
                const medio = !egreso ? medioDeGrupo(r.TipoGastoGrupoId) : null;
                const venta = r.VentaId != null ? ventas.get(Number(r.VentaId)) : undefined;
                return (
                  <tr key={r.RegistroDiarioCajaId} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-2 font-num text-text-muted">{hora(r.RegistroDiarioCajaFecha)}</td>
                    <td className="px-4 py-2">{descripcion(r)}</td>
                    <td className="px-4 py-2">
                      {egreso ? (
                        <Badge tone="danger">Egreso</Badge>
                      ) : medio ? (
                        <Badge tone={medio.tone}>{medio.label}</Badge>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right font-num font-semibold ${egreso ? "text-danger-700" : "text-text"}`}>
                      {egreso ? "−" : ""}
                      {formatMiles(r.RegistroDiarioCajaMonto)}
                    </td>
                    <td className="px-4 py-2">
                      {data.puedeCorregir && tipo && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={ArrowsRightLeftIcon}
                            onClick={() => setAccion({ tipo: "medio", registro: r, tipoMov: tipo })}
                          >
                            Medio
                          </Button>
                          {tipo === "VENTA" && venta && (
                            <Button
                              size="sm"
                              variant="ghost"
                              leftIcon={TrashIcon}
                              onClick={() => setAccion({ tipo: "anular", venta })}
                            >
                              Anular
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.correcciones.length > 0 && (
        <div className="border-t border-border p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Correcciones de este turno
          </h3>
          <ul className="space-y-1 text-sm">
            {data.correcciones.map((c) => (
              <li key={c.CorreccionCajaId} className="text-text">
                <span className="font-num text-text-muted">
                  {formatDateLocal(c.CorreccionCajaFecha)} {hora(c.CorreccionCajaFecha)}
                </span>{" "}
                · <strong>{c.UsuarioNombre || c.UsuarioId}</strong> ·{" "}
                {textoCorreccion(c)}
                {" — "}
                <span className="italic text-text-muted">{c.CorreccionCajaMotivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {accion?.tipo === "medio" && (
        <ModalMedio
          detalle={data}
          registro={accion.registro}
          tipoMov={accion.tipoMov}
          onClose={() => setAccion(null)}
          onHecho={() => despuesDeCorregir("Medio de cobro corregido")}
        />
      )}
      {accion?.tipo === "anular" && (
        <ModalAnular
          detalle={data}
          venta={accion.venta}
          onClose={() => setAccion(null)}
          onHecho={() => despuesDeCorregir("Venta anulada")}
        />
      )}
      {accion?.tipo === "cargar" && (
        <ModalCargar
          detalle={data}
          onClose={() => setAccion(null)}
          onHecho={() => despuesDeCorregir("Venta cargada en el turno")}
        />
      )}
      {accion?.tipo === "egreso" && (
        <ModalEgreso
          detalle={data}
          onClose={() => setAccion(null)}
          onHecho={() => despuesDeCorregir("Egreso cargado en el turno")}
        />
      )}
    </Card>
  );
}

function textoCorreccion(c: CorreccionRegistrada) {
  const accion = c.CorreccionCajaAccion;
  const id = c.CorreccionCajaEntidadId;
  if (c.CorreccionCajaEntidad === "REGISTRO") {
    // Editado/borrado desde Registro Diario Caja.
    const antes = (c.CorreccionCajaAntes || {}) as Record<string, unknown>;
    const despues = (c.CorreccionCajaDespues || {}) as Record<string, unknown>;
    const det = String(antes.RegistroDiarioCajaDetalle || `movimiento #${id}`);
    const montoAntes = Number(antes.RegistroDiarioCajaMonto) || 0;
    if (accion === "CARGAR") {
      // Egreso que faltó, cargado desde esta pantalla.
      const cargado = String(despues.RegistroDiarioCajaDetalle || `movimiento #${id}`);
      return `cargó el egreso "${cargado}" (Gs. ${formatMiles(Number(despues.RegistroDiarioCajaMonto) || 0)})`;
    }
    if (accion === "ELIMINAR") {
      return `eliminó "${det}" (Gs. ${formatMiles(montoAntes)}) desde Registro Diario Caja`;
    }
    const montoDespues = Number(despues.RegistroDiarioCajaMonto);
    const monto =
      !isNaN(montoDespues) && montoDespues !== montoAntes
        ? ` de Gs. ${formatMiles(montoAntes)} a Gs. ${formatMiles(montoDespues)}`
        : "";
    return `editó "${det}"${monto} desde Registro Diario Caja`;
  }
  const que = c.CorreccionCajaEntidad === "PAGO" ? `el cobro #${id}` : `la venta N° ${id}`;
  if (accion === "METODO") return `cambió el medio de ${que}`;
  if (accion === "ANULAR") return `anuló ${que}`;
  if (accion === "CARGAR") return `cargó ${que}`;
  return `${accion} ${que}`;
}

// ---------- Modales ----------

function Modal({
  titulo,
  onClose,
  bloqueado,
  children,
  ancho = "max-w-lg",
}: {
  titulo: string;
  onClose: () => void;
  bloqueado: boolean;
  children: ReactNode;
  ancho?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !bloqueado) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [bloqueado, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !bloqueado) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="correccion-modal-titulo"
        className={`max-h-[90vh] w-full ${ancho} overflow-y-auto rounded-lg bg-surface shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 id="correccion-modal-titulo" className="text-lg font-semibold text-text-strong">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={bloqueado}
            className="rounded p-1 text-text-muted hover:bg-surface-sunken"
            aria-label="Cerrar"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}

function CampoMotivo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium text-text">
      Motivo <span className="text-danger-700">*</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={250}
        placeholder="Ej.: el socio pagó en efectivo, se cargó como transferencia"
        className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
      />
    </label>
  );
}

/** Cómo queda la diferencia del turno si se aplica la corrección. */
function Vista({
  detalle,
  registrosDespues,
}: {
  detalle: TurnoDetalle;
  registrosDespues: RegistroTurno[];
}) {
  const { turno } = detalle;
  const antes = diferenciaTurno(detalle.registros, turno.aperturaId, turno.cierreId);
  const despues = diferenciaTurno(registrosDespues, turno.aperturaId, turno.cierreId);
  return (
    <div className="rounded-md bg-surface-sunken p-3 text-sm">
      {turno.abierto ? (
        <div>
          Efectivo esperado en el cajón: Gs. {formatMiles(antes.esperado)} →{" "}
          <strong>Gs. {formatMiles(despues.esperado)}</strong>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span>Cierre del turno:</span>
          <Diferencia valor={antes.diferencia} />
          <span aria-hidden>→</span>
          <Diferencia valor={despues.diferencia} />
        </div>
      )}
    </div>
  );
}

function useEnvio() {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enviar = async (fn: () => Promise<unknown>, onHecho: () => void) => {
    setEnviando(true);
    setError(null);
    try {
      await fn();
      onHecho();
    } catch (e) {
      setError((e as { message?: string }).message || "No se pudo guardar");
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, error, enviar };
}

function ModalMedio({
  detalle,
  registro,
  tipoMov,
  onClose,
  onHecho,
}: {
  detalle: TurnoDetalle;
  registro: RegistroTurno;
  tipoMov: TipoMov;
  onClose: () => void;
  onHecho: () => void;
}) {
  const actual = medioDeGrupo(registro.TipoGastoGrupoId);
  const opciones = MEDIOS.filter(
    (m) => m.key !== actual?.key && !(tipoMov === "COBRO_CREDITO" && m.key === "VOUCHER"),
  );
  const [medio, setMedio] = useState<Medio>(opciones[0]?.key || "EFECTIVO");
  const [motivo, setMotivo] = useState("");
  const { enviando, error, enviar } = useEnvio();

  const nuevoGrupo = MEDIOS.find((m) => m.key === medio)?.grupo ?? 1;
  const registrosDespues = detalle.registros.map((r) =>
    r.RegistroDiarioCajaId === registro.RegistroDiarioCajaId
      ? { ...r, TipoGastoGrupoId: nuevoGrupo }
      : r,
  );

  return (
    <Modal titulo="Cambiar medio de cobro" onClose={onClose} bloqueado={enviando}>
      <p className="text-sm text-text-muted">
        {registro.RegistroDiarioCajaDetalle} · Gs. {formatMiles(registro.RegistroDiarioCajaMonto)}
        <br />
        Cargado como <strong className="text-text">{actual?.label || "—"}</strong>.
      </p>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Se cobró con</legend>
        <div className="flex flex-wrap gap-2">
          {opciones.map((m) => (
            <label
              key={m.key}
              className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                medio === m.key ? "border-brand-700 bg-brand-50 text-brand-700" : "border-border text-text"
              }`}
            >
              <input
                type="radio"
                name="medio"
                value={m.key}
                checked={medio === m.key}
                onChange={() => setMedio(m.key)}
                className="sr-only"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <CampoMotivo value={motivo} onChange={setMotivo} />
      <Vista detalle={detalle} registrosDespues={registrosDespues} />
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={enviando}>
          Cancelar
        </Button>
        <Button
          onClick={() =>
            enviar(() => cambiarMedioMovimiento(registro.RegistroDiarioCajaId, medio, motivo), onHecho)
          }
          disabled={enviando || motivo.trim().length < 5}
        >
          {enviando ? "Guardando…" : "Corregir"}
        </Button>
      </div>
    </Modal>
  );
}

function ModalAnular({
  detalle,
  venta,
  onClose,
  onHecho,
}: {
  detalle: TurnoDetalle;
  venta: VentaTurno;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const { enviando, error, enviar } = useEnvio();
  const registrosDespues = detalle.registros.filter((r) => r.VentaId !== venta.VentaId);

  return (
    <Modal titulo={`Anular venta N° ${venta.VentaId}`} onClose={onClose} bloqueado={enviando}>
      <div className="text-sm text-text">
        <ul className="mb-2 list-inside list-disc">
          {venta.Items.map((i) => (
            <li key={`${i.ProductoId}-${i.VentaProductoPrecioTotal}`}>
              {i.VentaProductoCantidad} × {i.ProductoNombre} — Gs. {formatMiles(i.VentaProductoPrecioTotal)}
            </li>
          ))}
        </ul>
        <p className="text-text-muted">
          Total Gs. {formatMiles(venta.Total)}. Se devuelve el stock y se quitan sus
          movimientos de este turno.
        </p>
      </div>
      <CampoMotivo value={motivo} onChange={setMotivo} />
      <Vista detalle={detalle} registrosDespues={registrosDespues} />
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={enviando}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={() => enviar(() => anularVentaCorreccion(venta.VentaId, motivo), onHecho)}
          disabled={enviando || motivo.trim().length < 5}
        >
          {enviando ? "Anulando…" : "Anular venta"}
        </Button>
      </div>
    </Modal>
  );
}

interface ProductoCatalogo {
  ProductoId: number;
  ProductoCodigo?: string | null;
  ProductoNombre: string;
  ProductoPrecioVenta?: number | null;
  ProductoPrecioUnitario?: number | null;
}

interface Linea {
  ProductoId: number;
  ProductoNombre: string;
  cantidad: number;
  precioTotal: number;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function ModalCargar({
  detalle,
  onClose,
  onHecho,
}: {
  detalle: TurnoDetalle;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([]);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [medio, setMedio] = useState<Medio>("EFECTIVO");
  const [motivo, setMotivo] = useState("");
  const { enviando, error, enviar } = useEnvio();

  useEffect(() => {
    getProductosAll()
      .then((r: { data: ProductoCatalogo[] }) => setCatalogo(r.data || []))
      .catch((e: { message?: string }) =>
        setErrorCatalogo(e?.message || "No se pudo cargar el catálogo"),
      );
  }, []);

  const termino = normalizar(busqueda.trim());
  const sugeridos = termino
    ? catalogo
        .filter((p) => normalizar(`${p.ProductoNombre} ${p.ProductoCodigo || ""}`).includes(termino))
        .slice(0, 8)
    : [];

  const agregar = (p: ProductoCatalogo) => {
    const precio = Number(p.ProductoPrecioUnitario || p.ProductoPrecioVenta || 0);
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.ProductoId === p.ProductoId);
      if (i >= 0) {
        const copia = [...ls];
        const l = copia[i];
        const unit = l.cantidad ? l.precioTotal / l.cantidad : precio;
        copia[i] = { ...l, cantidad: l.cantidad + 1, precioTotal: Math.round(unit * (l.cantidad + 1)) };
        return copia;
      }
      return [...ls, { ProductoId: p.ProductoId, ProductoNombre: p.ProductoNombre, cantidad: 1, precioTotal: precio }];
    });
    setBusqueda("");
  };

  const total = lineas.reduce((s, l) => s + (Number(l.precioTotal) || 0), 0);
  const grupo = MEDIOS.find((m) => m.key === medio)?.grupo ?? 1;
  const { turno } = detalle;
  const registrosDespues: RegistroTurno[] = total
    ? [
        ...detalle.registros,
        {
          RegistroDiarioCajaId: Number.MAX_SAFE_INTEGER,
          CajaId: turno.cajaId,
          UsuarioId: turno.usuarioId,
          RegistroDiarioCajaFecha: turno.cierreFecha || turno.aperturaFecha,
          RegistroDiarioCajaMonto: total,
          TipoGastoId: 2,
          TipoGastoGrupoId: grupo,
          RegistroDiarioCajaDetalle: "Venta N°: (nueva)",
          AperturaRef: turno.aperturaId,
        },
      ]
    : detalle.registros;

  const valido =
    lineas.length > 0 &&
    lineas.every((l) => l.cantidad > 0 && l.precioTotal >= 0) &&
    total > 0 &&
    motivo.trim().length >= 5;

  const guardar = () =>
    enviar(
      () =>
        cargarVentaFaltante(turno.aperturaId, {
          motivo,
          Productos: lineas.map((l) => ({
            ProductoId: l.ProductoId,
            VentaProductoCantidad: l.cantidad,
            VentaProductoPrecioTotal: Math.round(l.precioTotal),
            ProductoUnidad: "U",
          })),
          Pagos: {
            Efectivo: medio === "EFECTIVO" ? total : 0,
            Banco: medio === "POS" ? total : 0,
            Voucher: medio === "VOUCHER" ? total : 0,
            Transferencia: medio === "TRANSFERENCIA" ? total : 0,
          },
        }),
      onHecho,
    );

  return (
    <Modal titulo="Cargar venta que faltó" onClose={onClose} bloqueado={enviando} ancho="max-w-2xl">
      <p className="text-sm text-text-muted">
        Se carga en este turno ({turno.cajaDescripcion}, {turno.usuarioNombre || turno.usuarioId}) con la fecha de su
        cierre. Descuenta stock, pero no mueve la caja de hoy.
      </p>

      <div className="relative">
        <TextInput
          leftIcon={MagnifyingGlassIcon}
          placeholder="Buscar producto…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar producto"
        />
        {errorCatalogo && <p className="mt-1 text-sm text-danger-700">{errorCatalogo}</p>}
        {sugeridos.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
            {sugeridos.map((p) => (
              <li key={p.ProductoId}>
                <button
                  type="button"
                  onClick={() => agregar(p)}
                  className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-surface-sunken"
                >
                  <span className="text-text">{p.ProductoNombre}</span>
                  <span className="font-num text-text-muted">
                    {formatMiles(Number(p.ProductoPrecioUnitario || p.ProductoPrecioVenta || 0))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lineas.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted">
              <th className="py-1 font-semibold">Producto</th>
              <th className="w-20 py-1 font-semibold">Cant.</th>
              <th className="w-32 py-1 text-right font-semibold">Total Gs.</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.ProductoId} className="border-t border-border">
                <td className="py-1 text-text">{l.ProductoNombre}</td>
                <td className="py-1">
                  <input
                    type="number"
                    min={1}
                    value={l.cantidad}
                    aria-label={`Cantidad de ${l.ProductoNombre}`}
                    onChange={(e) => {
                      const cantidad = Math.max(1, Number(e.target.value) || 1);
                      setLineas((ls) =>
                        ls.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                cantidad,
                                precioTotal: Math.round((x.precioTotal / x.cantidad) * cantidad),
                              }
                            : x,
                        ),
                      );
                    }}
                    className="w-16 rounded border border-border bg-surface px-2 py-1 font-num"
                  />
                </td>
                <td className="py-1 text-right">
                  <input
                    type="number"
                    min={0}
                    value={l.precioTotal}
                    aria-label={`Total de ${l.ProductoNombre}`}
                    onChange={(e) =>
                      setLineas((ls) =>
                        ls.map((x, j) =>
                          j === i ? { ...x, precioTotal: Math.max(0, Number(e.target.value) || 0) } : x,
                        ),
                      )
                    }
                    className="w-28 rounded border border-border bg-surface px-2 py-1 text-right font-num"
                  />
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                    className="rounded p-1 text-text-muted hover:text-danger-700"
                    aria-label={`Quitar ${l.ProductoNombre}`}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <td className="py-1 text-text" colSpan={2}>
                Total
              </td>
              <td className="py-1 text-right font-num text-text">{formatMiles(total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Se cobró con</legend>
        <div className="flex flex-wrap gap-2">
          {MEDIOS.map((m) => (
            <label
              key={m.key}
              className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                medio === m.key ? "border-brand-700 bg-brand-50 text-brand-700" : "border-border text-text"
              }`}
            >
              <input
                type="radio"
                name="medio-cargar"
                value={m.key}
                checked={medio === m.key}
                onChange={() => setMedio(m.key)}
                className="sr-only"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      <CampoMotivo value={motivo} onChange={setMotivo} />
      <Vista detalle={detalle} registrosDespues={registrosDespues} />
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={enviando}>
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={enviando || !valido}>
          {enviando ? "Cargando…" : "Cargar venta"}
        </Button>
      </div>
    </Modal>
  );
}

function ModalEgreso({
  detalle,
  onClose,
  onHecho,
}: {
  detalle: TurnoDetalle;
  onClose: () => void;
  onHecho: () => void;
}) {
  const grupos = detalle.gruposEgreso || [];
  const [grupo, setGrupo] = useState<number>(grupos[0]?.TipoGastoGrupoId ?? 0);
  const [detalleTxt, setDetalleTxt] = useState("");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const { enviando, error, enviar } = useEnvio();
  const { turno } = detalle;

  const montoNum = Math.round(Number(monto) || 0);
  const registrosDespues: RegistroTurno[] =
    montoNum > 0
      ? [
          ...detalle.registros,
          {
            RegistroDiarioCajaId: Number.MAX_SAFE_INTEGER,
            CajaId: turno.cajaId,
            UsuarioId: turno.usuarioId,
            RegistroDiarioCajaFecha: turno.cierreFecha || turno.aperturaFecha,
            RegistroDiarioCajaMonto: montoNum,
            TipoGastoId: 1,
            TipoGastoGrupoId: grupo,
            RegistroDiarioCajaDetalle: detalleTxt,
            AperturaRef: turno.aperturaId,
          },
        ]
      : detalle.registros;

  const valido = grupo > 0 && montoNum > 0 && motivo.trim().length >= 5;

  const guardar = () =>
    enviar(
      () =>
        cargarEgresoFaltante(turno.aperturaId, {
          motivo,
          TipoGastoGrupoId: grupo,
          RegistroDiarioCajaMonto: montoNum,
          RegistroDiarioCajaDetalle: detalleTxt.trim(),
        }),
      onHecho,
    );

  const claseCampo =
    "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700";

  return (
    <Modal titulo="Cargar egreso que faltó" onClose={onClose} bloqueado={enviando}>
      <p className="text-sm text-text-muted">
        Un gasto que se pagó con plata del cajón y no se registró. Se carga en este turno (
        {turno.cajaDescripcion}, {turno.usuarioNombre || turno.usuarioId}) con la fecha de su cierre y no mueve
        la caja de hoy.
      </p>

      {grupos.length === 0 ? (
        <p className="text-sm text-danger-700">
          No hay tipos de egreso configurados. Cargalos en Caja → Tipos de Gasto.
        </p>
      ) : (
        <label className="block text-sm font-medium text-text">
          Tipo de gasto <span className="text-danger-700">*</span>
          <select value={grupo} onChange={(e) => setGrupo(Number(e.target.value))} className={claseCampo}>
            {grupos.map((g) => (
              <option key={g.TipoGastoGrupoId} value={g.TipoGastoGrupoId}>
                {g.TipoGastoGrupoDescripcion}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-sm font-medium text-text">
        Detalle
        <input
          type="text"
          value={detalleTxt}
          maxLength={250}
          onChange={(e) => setDetalleTxt(e.target.value)}
          placeholder="Ej.: compra de hielo"
          className={claseCampo}
        />
      </label>

      <label className="block text-sm font-medium text-text">
        Monto Gs. <span className="text-danger-700">*</span>
        <input
          type="number"
          min={1}
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className={`${claseCampo} text-right font-num`}
        />
      </label>

      <CampoMotivo value={motivo} onChange={setMotivo} />
      <Vista detalle={detalle} registrosDespues={registrosDespues} />
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={enviando}>
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={enviando || !valido}>
          {enviando ? "Cargando…" : "Cargar egreso"}
        </Button>
      </div>
    </Modal>
  );
}
