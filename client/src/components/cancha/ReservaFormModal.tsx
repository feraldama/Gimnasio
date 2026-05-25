import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import {
  createReserva,
  updateReserva,
  deleteReserva,
  sugerirMontoReserva,
  anularCobroReserva,
  listarSerie,
  cancelarSerie,
  type Cancha,
  type CanchaReserva,
  type SugerirMontoResp,
} from "../../services/cancha.service";
import { Button, Badge } from "../common/ui";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { formatMiles, todayLocalISO } from "../../utils/utils";
import ClienteModal from "../common/ClienteModal";
import type { Cliente as ClienteFull } from "../common/ClienteFormModal";
import CobrarReservaModal from "./CobrarReservaModal";

// Usamos el tipo Cliente completo del design system para poder pasar la lista
// directo al ClienteModal de búsqueda (tabla con filtros). El backend devuelve
// el objeto completo así que no perdemos datos.
type ClienteOpt = ClienteFull;

// Normaliza un teléfono paraguayo al formato internacional sin "+" para wa.me.
// Acepta variantes: "0981234567", "+595981234567", "595981234567", "0981 234 567".
function normalizarTelefonoPy(raw?: string): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("595")) return digits;
  if (digits.startsWith("0")) return "595" + digits.slice(1);
  return "595" + digits;
}

// Mensaje de recordatorio de reserva para WhatsApp.
function buildMensajeReserva(opts: {
  nombre: string;
  cancha: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  monto: number;
}): string {
  const [y, m, d] = opts.fecha.split("-");
  const fechaLocal = d && m && y ? `${d}/${m}/${y}` : opts.fecha;
  return (
    `Hola ${opts.nombre}, te confirmamos tu reserva de cancha:\n` +
    `\n` +
    `📍 ${opts.cancha}\n` +
    `📅 ${fechaLocal}\n` +
    `⏰ ${opts.horaInicio} a ${opts.horaFin}\n` +
    (opts.monto > 0
      ? `💰 Gs. ${opts.monto.toLocaleString("es-PY")}\n`
      : "") +
    `\n¡Te esperamos!`
  );
}

export interface ReservaFormInitial {
  CanchaReservaId?: number;
  CanchaId?: number;
  ClienteId?: number | null;
  CanchaReservaCliente?: string;
  CanchaReservaFecha?: string;
  CanchaReservaHoraInicio?: string;
  CanchaReservaHoraFin?: string;
  CanchaReservaMonto?: number;
  CanchaReservaEstado?: string;
  CanchaReservaObservacion?: string;
  // Si la reserva es parte de una serie, el modal muestra un panel especial
  // con la opción de cancelar la serie completa.
  CanchaReservaSerieId?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  canchas: Cancha[];
  clientes: ClienteOpt[];
  initial?: ReservaFormInitial;
  puedeCrear?: boolean;
  puedeEditar?: boolean;
  puedeEliminar?: boolean;
}

const ESTADO_LABEL: Record<string, string> = {
  R: "Reservada",
  P: "Pagada",
  X: "Cancelada",
};

interface FormState {
  CanchaReservaId: number;
  CanchaId: number;
  ClienteId: number | null;
  CanchaReservaCliente: string;
  CanchaReservaFecha: string;
  CanchaReservaHoraInicio: string;
  CanchaReservaHoraFin: string;
  CanchaReservaMonto: number;
  CanchaReservaEstado: string;
  CanchaReservaObservacion: string;
}

function tsToHHMM(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    const m = ts.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : "";
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function dtLocal(fecha: string, hora: string): string {
  if (!fecha || !hora) return "";
  const h = hora.length === 5 ? hora + ":00" : hora;
  return `${fecha} ${h}`;
}

function buildInitialForm(initial: ReservaFormInitial | undefined): FormState {
  return {
    CanchaReservaId: initial?.CanchaReservaId ?? 0,
    CanchaId: initial?.CanchaId ?? 0,
    ClienteId: initial?.ClienteId ?? null,
    CanchaReservaCliente: initial?.CanchaReservaCliente ?? "",
    CanchaReservaFecha:
      initial?.CanchaReservaFecha?.slice(0, 10) ?? todayLocalISO(),
    CanchaReservaHoraInicio: initial?.CanchaReservaHoraInicio
      ? tsToHHMM(initial.CanchaReservaHoraInicio) ||
        initial.CanchaReservaHoraInicio
      : "",
    CanchaReservaHoraFin: initial?.CanchaReservaHoraFin
      ? tsToHHMM(initial.CanchaReservaHoraFin) || initial.CanchaReservaHoraFin
      : "",
    CanchaReservaMonto: initial?.CanchaReservaMonto ?? 0,
    CanchaReservaEstado: initial?.CanchaReservaEstado ?? "R",
    CanchaReservaObservacion: initial?.CanchaReservaObservacion ?? "",
  };
}

// Modal compartido de alta/edición de reserva.
//
// Carga inicial:
//   - Si `initial.CanchaReservaId` viene > 0 → modo edición. El monto inicial
//     se respeta (montoTocadoManual=true) hasta que el usuario pida recalcular.
//   - Si no viene → modo creación. El monto arranca en 0 y se llena solo con
//     la tarifa sugerida; si el usuario lo edita, se respeta.
export default function ReservaFormModal({
  open,
  onClose,
  onSaved,
  canchas,
  clientes,
  initial,
  puedeCrear = true,
  puedeEditar = true,
  puedeEliminar = true,
}: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitialForm(initial));
  const [saving, setSaving] = useState(false);
  const [sugerencia, setSugerencia] = useState<SugerirMontoResp | null>(null);
  const [montoTocadoManual, setMontoTocadoManual] = useState(false);
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [showCobrarModal, setShowCobrarModal] = useState(false);
  // Conteo de reservas activas (R+P) de la serie a la que pertenece esta reserva.
  // null = todavía no se consultó / no es de una serie. Lo cargamos al abrir.
  const [serieInfo, setSerieInfo] = useState<{
    total: number;
    activas: number;
    pagadas: number;
  } | null>(null);

  // Resetear el estado cada vez que se abre con un nuevo `initial`.
  useEffect(() => {
    if (!open) return;
    setForm(buildInitialForm(initial));
    setSugerencia(null);
    setMontoTocadoManual(Boolean(initial?.CanchaReservaId));
    setSerieInfo(null);
    // Si la reserva es parte de una serie, traer el resumen (cuántas R/P/X)
    // para mostrarlo en el panel.
    const serieId = initial?.CanchaReservaSerieId;
    if (open && serieId) {
      let cancelado = false;
      listarSerie(serieId)
        .then((r) => {
          if (cancelado) return;
          setSerieInfo({
            total: r.data.length,
            activas: r.data.filter((x) => x.CanchaReservaEstado === "R").length,
            pagadas: r.data.filter((x) => x.CanchaReservaEstado === "P").length,
          });
        })
        .catch(() => {
          /* silencioso — sin panel, no es bloqueante */
        });
      return () => {
        cancelado = true;
      };
    }
  }, [open, initial]);

  // Pedir sugerencia de tarifa cuando hay datos suficientes.
  useEffect(() => {
    if (!open) return;
    if (
      !form.CanchaId ||
      !form.CanchaReservaFecha ||
      !form.CanchaReservaHoraInicio ||
      !form.CanchaReservaHoraFin ||
      form.CanchaReservaHoraFin <= form.CanchaReservaHoraInicio
    ) {
      setSugerencia(null);
      return;
    }
    let cancelado = false;
    const t = setTimeout(async () => {
      try {
        const r = await sugerirMontoReserva({
          canchaId: form.CanchaId,
          fecha: form.CanchaReservaFecha,
          horaInicio: form.CanchaReservaHoraInicio,
          horaFin: form.CanchaReservaHoraFin,
        });
        if (cancelado) return;
        setSugerencia(r);
        if (!montoTocadoManual) {
          setForm((prev) => ({ ...prev, CanchaReservaMonto: r.monto }));
        }
      } catch {
        if (!cancelado) setSugerencia(null);
      }
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [
    open,
    form.CanchaId,
    form.CanchaReservaFecha,
    form.CanchaReservaHoraInicio,
    form.CanchaReservaHoraFin,
    montoTocadoManual,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!form.CanchaId) {
      Swal.fire({ icon: "warning", title: "Falta cancha" });
      return;
    }
    if (!form.CanchaReservaHoraInicio || !form.CanchaReservaHoraFin) {
      Swal.fire({ icon: "warning", title: "Faltan horarios" });
      return;
    }
    const payload = {
      CanchaId: form.CanchaId,
      ClienteId: form.ClienteId,
      CanchaReservaCliente: form.CanchaReservaCliente,
      CanchaReservaFecha: form.CanchaReservaFecha,
      CanchaReservaHoraInicio: dtLocal(
        form.CanchaReservaFecha,
        form.CanchaReservaHoraInicio
      ),
      CanchaReservaHoraFin: dtLocal(
        form.CanchaReservaFecha,
        form.CanchaReservaHoraFin
      ),
      CanchaReservaMonto: Number(form.CanchaReservaMonto) || 0,
      CanchaReservaEstado: form.CanchaReservaEstado,
      CanchaReservaObservacion: form.CanchaReservaObservacion,
    };
    try {
      setSaving(true);
      if (form.CanchaReservaId) {
        await updateReserva(form.CanchaReservaId, payload);
      } else {
        await createReserva(payload as Partial<CanchaReserva>);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err?.code === "CONFLICTO_HORARIO") {
        Swal.fire({
          icon: "warning",
          title: "Horario ocupado",
          text: err.message || "Esa cancha ya tiene una reserva en ese horario.",
        });
        return;
      }
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err?.message || "No se pudo guardar",
      });
    } finally {
      setSaving(false);
    }
  }, [form, onClose, onSaved]);

  const handleDelete = useCallback(async () => {
    if (!form.CanchaReservaId) return;
    const c = await Swal.fire({
      title: "¿Eliminar reserva?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#dc2626",
    });
    if (!c.isConfirmed) return;
    try {
      await deleteReserva(form.CanchaReservaId);
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      Swal.fire({
        icon: "error",
        title:
          err.code === "TIENE_CREDITO_PENDIENTE"
            ? "Crédito pendiente"
            : "Error",
        text: err.message || "No se pudo eliminar",
      });
    }
  }, [form.CanchaReservaId, onClose, onSaved]);

  // Anula el cobro: revierte caja + borra crédito + reserva vuelve a R.
  // Confirmación explícita porque es destructivo (modifica caja).
  const handleAnularCobro = useCallback(async () => {
    if (!form.CanchaReservaId) return;
    const c = await Swal.fire({
      title: "¿Anular el cobro?",
      html: `
        <p class="text-sm text-left">
          Esta acción va a:
        </p>
        <ul class="text-sm text-left list-disc list-inside mt-2">
          <li>Registrar los movimientos de contrapartida en la caja.</li>
          <li>Restar de tu caja el efectivo cobrado (sólo Contado).</li>
          <li>Borrar el crédito asociado a esta reserva (si existe y no recibió pagos).</li>
          <li>Volver la reserva a estado Reservada.</li>
        </ul>
        <p class="text-xs text-amber-700 mt-3">
          Si la reserva tenía un crédito con pagos parciales aplicados, la
          anulación se rechaza — anular esos pagos primero.
        </p>
      `,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, anular",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#d97706",
    });
    if (!c.isConfirmed) return;
    try {
      const r = await anularCobroReserva(form.CanchaReservaId);
      await Swal.fire({
        icon: "success",
        title: "Cobro anulado",
        html: `
          <div class="text-sm text-left">
            <p>Movimientos revertidos: <strong>${r.anulacion.movimientosRevertidos}</strong></p>
            <p>Efectivo descontado de caja: <strong>Gs. ${formatMiles(r.anulacion.efectivoDescontadoDeCaja)}</strong></p>
            ${
              r.anulacion.creditoBorrado
                ? "<p>Crédito asociado borrado.</p>"
                : ""
            }
          </div>
        `,
        confirmButtonText: "Cerrar",
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      const titulos = {
        SIN_CAJA: "Sin caja abierta",
        NO_PAGADA: "Reserva no pagada",
        CREDITO_CON_PAGOS: "Crédito con pagos parciales",
      } as const;
      Swal.fire({
        icon: "error",
        title: titulos[err.code as keyof typeof titulos] || "No se pudo anular",
        text: err.message || "Error al anular el cobro",
      });
    }
  }, [form.CanchaReservaId, onClose, onSaved]);

  // Cancela todas las reservas R de la serie. Las P no se tocan acá — anularlas
  // requiere el flujo de anular-cobro individual.
  const handleCancelarSerie = useCallback(async () => {
    const serieId = initial?.CanchaReservaSerieId;
    if (!serieId) return;
    const c = await Swal.fire({
      title: "¿Cancelar la serie completa?",
      html: `
        <p class="text-sm text-left">
          Vas a marcar como <strong>Canceladas</strong> todas las reservas
          activas de esta serie.
        </p>
        ${
          serieInfo
            ? `<ul class="text-sm text-left list-disc list-inside mt-2">
                 <li>Total en la serie: ${serieInfo.total}</li>
                 <li>Se cancelarán: ${serieInfo.activas}</li>
                 ${
                   serieInfo.pagadas > 0
                     ? `<li class="text-amber-700">Pagadas (no se tocan): ${serieInfo.pagadas} — anularlas requiere anular-cobro individual.</li>`
                     : ""
                 }
               </ul>`
            : ""
        }
      `,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, cancelar serie",
      cancelButtonText: "Volver",
      confirmButtonColor: "#dc2626",
    });
    if (!c.isConfirmed) return;
    try {
      const r = await cancelarSerie(serieId);
      await Swal.fire({
        icon: "success",
        title: "Serie cancelada",
        html: `
          <div class="text-sm text-left">
            <p>Reservas canceladas: <strong>${r.canceladas}</strong></p>
            ${
              r.conPagadas.length > 0
                ? `<p class="text-amber-700 mt-2">${r.conPagadas.length} reserva(s) pagada(s) quedaron sin tocar.</p>`
                : ""
            }
          </div>
        `,
        confirmButtonText: "Cerrar",
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.message || "No se pudo cancelar la serie",
      });
    }
  }, [initial, serieInfo, onClose, onSaved]);

  if (!open) return null;

  const esEdicion = form.CanchaReservaId > 0;

  // Datos derivados para la sección de WhatsApp (solo se usan si esEdicion).
  // Calculados afuera del JSX para mantener el render simple y evitar IIFE.
  const clienteVinculado = clientes.find((c) => c.ClienteId === form.ClienteId);
  const telWa = normalizarTelefonoPy(clienteVinculado?.ClienteTelefono);
  const canchaSel = canchas.find((c) => c.CanchaId === form.CanchaId);
  const nombreClienteWa = clienteVinculado
    ? `${clienteVinculado.ClienteNombre} ${clienteVinculado.ClienteApellido ?? ""}`.trim()
    : form.CanchaReservaCliente || "";
  const waHabilitado =
    !!clienteVinculado && !!telWa && !!canchaSel;
  const onWhatsApp = () => {
    if (!waHabilitado || !canchaSel) return;
    const msg = buildMensajeReserva({
      nombre: nombreClienteWa.split(" ")[0] || nombreClienteWa,
      cancha: canchaSel.CanchaNombre,
      fecha: form.CanchaReservaFecha,
      horaInicio: form.CanchaReservaHoraInicio,
      horaFin: form.CanchaReservaHoraFin,
      monto: form.CanchaReservaMonto,
    });
    const url = `https://wa.me/${telWa}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {esEdicion ? "Editar reserva" : "Nueva reserva"}
          </h2>
          {esEdicion && (
            <Badge
              tone={
                form.CanchaReservaEstado === "P"
                  ? "success"
                  : form.CanchaReservaEstado === "X"
                  ? "danger"
                  : "warning"
              }
            >
              {ESTADO_LABEL[form.CanchaReservaEstado] ||
                form.CanchaReservaEstado}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Cancha</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
              value={form.CanchaId}
              onChange={(e) =>
                setForm({ ...form, CanchaId: Number(e.target.value) })
              }
            >
              <option value={0}>— Seleccionar —</option>
              {canchas.map((c) => (
                <option key={c.CanchaId} value={c.CanchaId}>
                  {c.CanchaNombre}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">
              Cliente (opcional)
            </label>
            <div className="flex gap-2 items-stretch">
              <button
                type="button"
                onClick={() => setShowClienteModal(true)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-left text-sm bg-white hover:bg-gray-50 cursor-pointer transition-colors flex items-center justify-between"
                title="Abrir buscador de clientes"
              >
                {clienteVinculado ? (
                  <span className="font-medium text-gray-900">
                    {clienteVinculado.ClienteNombre}{" "}
                    {clienteVinculado.ClienteApellido ?? ""}
                    {clienteVinculado.ClienteRUC ? (
                      <span className="ml-2 text-xs text-gray-500 tabular-nums">
                        {clienteVinculado.ClienteRUC}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-gray-500">
                    — Invitado / externo —{" "}
                    <span className="text-blue-600 underline">
                      Buscar cliente
                    </span>
                  </span>
                )}
              </button>
              {form.ClienteId && (
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, ClienteId: null })
                  }
                  className="px-3 py-2 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
                  title="Quitar cliente (volver a invitado)"
                >
                  Quitar
                </button>
              )}
            </div>
          </div>

          {/* El nombre de invitado solo aplica cuando no hay cliente vinculado.
              Si el usuario ya seleccionó un cliente real, ocultamos el campo. */}
          {!form.ClienteId && (
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">
                Nombre (si es invitado)
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                value={form.CanchaReservaCliente}
                onChange={(e) =>
                  setForm({ ...form, CanchaReservaCliente: e.target.value })
                }
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">Fecha</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
              value={form.CanchaReservaFecha}
              onChange={(e) =>
                setForm({ ...form, CanchaReservaFecha: e.target.value })
              }
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Estado</label>
            {/* Si la reserva ya está Pagada, deshabilitamos el select porque
                pasarla a R/X desde acá no reverte ni el movimiento de caja
                ni el crédito asociado — la caja quedaría inconsistente. La
                única forma legítima de revertir un cobro es una anulación
                explícita (ver hallazgo #4 de auditoría). */}
            <select
              className={`w-full px-3 py-2 border border-gray-300 rounded-md ${
                form.CanchaReservaEstado === "P"
                  ? "cursor-not-allowed bg-gray-100 text-gray-500"
                  : "cursor-pointer"
              }`}
              value={form.CanchaReservaEstado}
              onChange={(e) =>
                setForm({ ...form, CanchaReservaEstado: e.target.value })
              }
              disabled={form.CanchaReservaEstado === "P"}
              title={
                form.CanchaReservaEstado === "P"
                  ? "Una reserva pagada no se edita desde acá. Para revertir el cobro hace falta un proceso de anulación."
                  : ""
              }
            >
              <option value="R">Reservada</option>
              <option value="P">Pagada</option>
              <option value="X">Cancelada</option>
            </select>
            {form.CanchaReservaEstado === "P" && (
              <p className="mt-1 text-xs text-amber-700">
                Reserva pagada — el estado no se puede editar manualmente.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Hora inicio
            </label>
            <input
              type="time"
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
              value={form.CanchaReservaHoraInicio}
              onChange={(e) =>
                setForm({
                  ...form,
                  CanchaReservaHoraInicio: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
            <input
              type="time"
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
              value={form.CanchaReservaHoraFin}
              onChange={(e) =>
                setForm({ ...form, CanchaReservaHoraFin: e.target.value })
              }
            />
          </div>

          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">
              Monto (Gs.)
            </label>
            <input
              type="text"
              inputMode="numeric"
              className="w-full px-3 py-2 border border-gray-300 rounded-md tabular-nums"
              value={
                form.CanchaReservaMonto
                  ? formatMiles(form.CanchaReservaMonto)
                  : ""
              }
              placeholder="0"
              onChange={(e) => {
                const raw = e.target.value
                  .replace(/\./g, "")
                  .replace(/\s/g, "");
                if (raw === "") {
                  setMontoTocadoManual(true);
                  setForm({ ...form, CanchaReservaMonto: 0 });
                  return;
                }
                const num = Number(raw);
                if (!isNaN(num)) {
                  setMontoTocadoManual(true);
                  setForm({ ...form, CanchaReservaMonto: num });
                }
              }}
            />
            {sugerencia && (
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="text-gray-600">
                  {sugerencia.banda ? (
                    <>
                      Tarifa sugerida:{" "}
                      <strong className="text-blue-700">
                        Gs. {formatMiles(sugerencia.monto)}
                      </strong>{" "}
                      <span className="text-gray-500">
                        ({sugerencia.banda.nombre || "banda"} ·{" "}
                        {sugerencia.duracionHoras.toFixed(1)} h)
                      </span>
                    </>
                  ) : sugerencia.fuente === "MIXTA" && sugerencia.bandas ? (
                    <>
                      Tarifa sugerida (mixta):{" "}
                      <strong className="text-blue-700">
                        Gs. {formatMiles(sugerencia.monto)}
                      </strong>{" "}
                      <span
                        className="text-gray-500"
                        title={sugerencia.bandas
                          .map(
                            (b) =>
                              `${b.nombre}: ${b.horas}h × Gs.${formatMiles(b.precio)}`
                          )
                          .join("\n")}
                      >
                        ({sugerencia.bandas.length} bandas ·{" "}
                        {sugerencia.duracionHoras.toFixed(1)} h)
                      </span>
                    </>
                  ) : sugerencia.fuente === "FLAT_CANCHA" ? (
                    <>
                      Sin banda definida — tarifa flat de la cancha:{" "}
                      <strong className="text-blue-700">
                        Gs. {formatMiles(sugerencia.monto)}
                      </strong>
                    </>
                  ) : (
                    <span className="text-amber-700">
                      Sin tarifa configurada para esta cancha
                    </span>
                  )}
                </span>
                {sugerencia.monto > 0 &&
                  sugerencia.monto !== form.CanchaReservaMonto && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm({
                          ...form,
                          CanchaReservaMonto: sugerencia.monto,
                        });
                        setMontoTocadoManual(false);
                      }}
                      className="text-blue-600 hover:underline cursor-pointer font-medium"
                    >
                      Aplicar
                    </button>
                  )}
              </div>
            )}
          </div>

          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">
              Observación
            </label>
            <textarea
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              value={form.CanchaReservaObservacion}
              onChange={(e) =>
                setForm({
                  ...form,
                  CanchaReservaObservacion: e.target.value,
                })
              }
            />
          </div>
        </div>

        {esEdicion && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md flex items-center justify-between gap-3">
            <div className="text-xs text-green-900">
              <strong>Compartir con el cliente:</strong>{" "}
              {waHabilitado
                ? `Se abrirá WhatsApp con el mensaje pre-armado para ${nombreClienteWa}.`
                : clienteVinculado
                ? "El cliente no tiene teléfono cargado en su ficha."
                : "Vinculá un cliente con teléfono para habilitar el envío."}
            </div>
            <button
              type="button"
              onClick={onWhatsApp}
              disabled={!waHabilitado}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap ${
                waHabilitado
                  ? "bg-green-600 text-white hover:bg-green-700 cursor-pointer"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
              title={
                waHabilitado
                  ? "Abrir WhatsApp con el mensaje listo"
                  : "Cliente sin teléfono"
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01zm-7.01 15.24c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.22 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12s-.64.81-.78.97c-.14.17-.29.19-.54.06a6.7 6.7 0 0 1-2-1.23 7.45 7.45 0 0 1-1.38-1.72c-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07s.89 2.4 1.01 2.56c.12.17 1.74 2.66 4.22 3.73.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18s-.22-.16-.47-.28z" />
              </svg>
              WhatsApp
            </button>
          </div>
        )}

        {esEdicion && form.CanchaReservaEstado === "R" && puedeEditar && (
          <div className="mt-4 flex items-center justify-between gap-3 p-3 bg-green-50 border border-green-200 rounded-md">
            <div className="text-sm text-green-900">
              <strong>Cobrar reserva:</strong> registra el ingreso en la caja
              abierta y marca esta reserva como Pagada.
            </div>
            <Button
              variant="success"
              onClick={() => setShowCobrarModal(true)}
              disabled={saving}
              className="cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <BanknotesIcon className="w-4 h-4" />
              Cobrar
            </Button>
          </div>
        )}

        {esEdicion && initial?.CanchaReservaSerieId && (
          <div className="mt-4 flex items-center justify-between gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="text-sm text-blue-900">
              <strong>🔁 Parte de una serie recurrente</strong>
              {serieInfo ? (
                <div className="text-xs mt-0.5">
                  Serie #{initial.CanchaReservaSerieId} ·{" "}
                  {serieInfo.total} reserva{serieInfo.total === 1 ? "" : "s"} en total
                  {serieInfo.activas > 0
                    ? ` · ${serieInfo.activas} activa${serieInfo.activas === 1 ? "" : "s"}`
                    : ""}
                  {serieInfo.pagadas > 0
                    ? ` · ${serieInfo.pagadas} pagada${serieInfo.pagadas === 1 ? "" : "s"}`
                    : ""}
                </div>
              ) : (
                <div className="text-xs mt-0.5 text-blue-700">Cargando resumen...</div>
              )}
            </div>
            {puedeEliminar &&
              serieInfo &&
              serieInfo.activas > 0 && (
                <Button
                  variant="danger"
                  onClick={handleCancelarSerie}
                  disabled={saving}
                  className="cursor-pointer whitespace-nowrap"
                  title="Cancelar todas las reservas activas de la serie"
                >
                  Cancelar serie
                </Button>
              )}
          </div>
        )}

        {esEdicion && form.CanchaReservaEstado === "P" && puedeEliminar && (
          <div className="mt-4 flex items-center justify-between gap-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
            <div className="text-sm text-amber-900">
              <strong>Anular cobro:</strong> revierte los movimientos de caja,
              borra el crédito asociado (si lo hay) y deja la reserva como
              Reservada para volver a cobrarla.
            </div>
            <Button
              variant="warning"
              onClick={handleAnularCobro}
              disabled={saving}
              className="cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              Anular cobro
            </Button>
          </div>
        )}

        <div className="flex justify-between items-center gap-2 mt-6">
          <div>
            {esEdicion && puedeEliminar && (
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={saving}
                className="cursor-pointer"
              >
                Eliminar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={saving}
              className="cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={saving || (esEdicion ? !puedeEditar : !puedeCrear)}
              className="cursor-pointer"
            >
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      </div>

      <CobrarReservaModal
        open={showCobrarModal}
        reserva={
          esEdicion
            ? ({
                CanchaReservaId: form.CanchaReservaId,
                CanchaId: form.CanchaId,
                ClienteId: form.ClienteId,
                CanchaReservaCliente: form.CanchaReservaCliente,
                CanchaReservaFecha: form.CanchaReservaFecha,
                CanchaReservaHoraInicio: form.CanchaReservaHoraInicio,
                CanchaReservaHoraFin: form.CanchaReservaHoraFin,
                CanchaReservaMonto: form.CanchaReservaMonto,
                CanchaReservaEstado: form.CanchaReservaEstado,
                CanchaReservaObservacion: form.CanchaReservaObservacion,
                ClienteNombre: clienteVinculado?.ClienteNombre,
                ClienteApellido: clienteVinculado?.ClienteApellido,
              } as CanchaReserva)
            : null
        }
        onClose={() => setShowCobrarModal(false)}
        onCobrado={() => {
          onSaved();
          onClose();
        }}
      />

      {/* Búsqueda de cliente (tabla con filtros). Mismo modal que Suscripciones. */}
      <ClienteModal
        show={showClienteModal}
        onClose={() => setShowClienteModal(false)}
        clientes={clientes}
        onSelect={(c) => {
          const id =
            typeof c.ClienteId === "number"
              ? c.ClienteId
              : Number(c.ClienteId);
          if (!Number.isFinite(id)) {
            setShowClienteModal(false);
            return;
          }
          setForm({
            ...form,
            ClienteId: id,
            // Si era invitado, limpiamos el texto libre para usar el del cliente real.
            CanchaReservaCliente: "",
          });
          setShowClienteModal(false);
        }}
      />
    </div>
  );
}
