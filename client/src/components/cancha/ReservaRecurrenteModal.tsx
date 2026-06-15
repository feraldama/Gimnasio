import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import Swal from "sweetalert2";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Button } from "../common/ui";
import {
  crearReservaRecurrente,
  type Cancha,
} from "../../services/cancha.service";
import {
  addDaysLocal,
  formatDateLocal,
  formatMiles,
  todayLocalISO,
} from "../../utils/utils";
import ClienteModal from "../common/ClienteModal";
import type { Cliente as ClienteFull } from "../common/ClienteFormModal";

interface Props {
  open: boolean;
  canchas: Cancha[];
  clientes: ClienteFull[];
  onClose: () => void;
  onCreada: () => void;
}

const DIAS_SEM = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

// Devuelve el nombre del día de la semana para una fecha ISO (zona local).
function diaSemanaDe(fechaISO: string): string {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DIAS_SEM[new Date(y, m - 1, d).getDay()];
}

// Selector de días — mismas siglas que las bandas de tarifa (L,M,X,J,V,S,D).
const DIAS = [
  { sigla: "L", label: "Lun" },
  { sigla: "M", label: "Mar" },
  { sigla: "X", label: "Mié" },
  { sigla: "J", label: "Jue" },
  { sigla: "V", label: "Vie" },
  { sigla: "S", label: "Sáb" },
  { sigla: "D", label: "Dom" },
];
const OFFSET_LUN: Record<string, number> = {
  L: 0,
  M: 1,
  X: 2,
  J: 3,
  V: 4,
  S: 5,
  D: 6,
};
// getDay (0=Dom..6=Sab) -> sigla.
const SIGLA_BY_JSDAY = ["D", "L", "M", "X", "J", "V", "S"];

function parseDias(csv: string): string[] {
  return (csv || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => OFFSET_LUN[s] !== undefined);
}

function siglaDeFecha(fechaISO: string): string {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  if (!y || !m || !d) return "";
  return SIGLA_BY_JSDAY[new Date(y, m - 1, d).getDay()];
}

// Genera las fechas de la serie: para cada una de las N semanas, una fecha por
// cada día seleccionado. Ancla al lunes de la semana de `fechaInicio` y descarta
// ocurrencias anteriores a esa fecha. Debe coincidir con la lógica del backend.
function generarFechas(
  fechaInicio: string,
  semanas: number,
  diasCsv: string
): string[] {
  const dias = parseDias(diasCsv);
  if (!fechaInicio || semanas < 1 || dias.length === 0) return [];
  const [y, m, d] = fechaInicio.split("-").map(Number);
  if (!y || !m || !d) return [];
  const jsDay = new Date(y, m - 1, d).getDay();
  const lunesISO = addDaysLocal(fechaInicio, jsDay === 0 ? -6 : 1 - jsDay);
  const out: string[] = [];
  for (let w = 0; w < semanas; w++) {
    for (const dia of DIAS) {
      if (!dias.includes(dia.sigla)) continue;
      const f = addDaysLocal(lunesISO, w * 7 + OFFSET_LUN[dia.sigla]);
      if (f >= fechaInicio) out.push(f);
    }
  }
  return out;
}

export default function ReservaRecurrenteModal({
  open,
  canchas,
  clientes,
  onClose,
  onCreada,
}: Props) {
  const [canchaId, setCanchaId] = useState(0);
  const [clienteSeleccionado, setClienteSeleccionado] =
    useState<ClienteFull | null>(null);
  const [nombreInvitado, setNombreInvitado] = useState("");
  const [fechaInicio, setFechaInicio] = useState(todayLocalISO());
  // Días a generar (CSV de siglas). `diasTocado` indica que el operador eligió
  // días manualmente; mientras sea false, el día se sincroniza con fechaInicio
  // para preservar el comportamiento previo (una reserva semanal en ese día).
  const [diasSemana, setDiasSemana] = useState(siglaDeFecha(todayLocalISO()));
  const [diasTocado, setDiasTocado] = useState(false);
  const [cantSemanas, setCantSemanas] = useState(4);
  const [horaInicio, setHoraInicio] = useState("19:00");
  const [horaFin, setHoraFin] = useState("20:00");
  const [monto, setMonto] = useState(0);
  const [observacion, setObservacion] = useState("");
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Reset al abrir
  useEffect(() => {
    if (!open) return;
    setCanchaId(canchas[0]?.CanchaId ?? 0);
    setClienteSeleccionado(null);
    setNombreInvitado("");
    setFechaInicio(todayLocalISO());
    setDiasSemana(siglaDeFecha(todayLocalISO()));
    setDiasTocado(false);
    setCantSemanas(4);
    setHoraInicio("19:00");
    setHoraFin("20:00");
    setMonto(0);
    setObservacion("");
  }, [open, canchas]);

  // Mientras el operador no haya tocado los días, el día seleccionado sigue al
  // de la primera fecha (comportamiento histórico: reserva semanal ese día).
  useEffect(() => {
    if (!diasTocado && fechaInicio) setDiasSemana(siglaDeFecha(fechaInicio));
  }, [fechaInicio, diasTocado]);

  const toggleDia = (sigla: string) => {
    setDiasTocado(true);
    const set = new Set(parseDias(diasSemana));
    if (set.has(sigla)) set.delete(sigla);
    else set.add(sigla);
    setDiasSemana(
      DIAS.filter((d) => set.has(d.sigla))
        .map((d) => d.sigla)
        .join(",")
    );
  };

  const setDiasShortcut = (kind: "todos" | "habiles" | "finde") => {
    setDiasTocado(true);
    const map = { todos: "L,M,X,J,V,S,D", habiles: "L,M,X,J,V", finde: "S,D" };
    setDiasSemana(map[kind]);
  };

  // Preview de fechas: vista en vivo de qué reservas se van a generar.
  // El backend valida cada una contra bloqueos/conflictos; acá sólo mostramos
  // las fechas calculadas para que el operador confirme el patrón.
  const fechasPreview = useMemo(() => {
    if (cantSemanas < 2) return [];
    return generarFechas(fechaInicio, cantSemanas, diasSemana);
  }, [fechaInicio, cantSemanas, diasSemana]);

  // Cerrar con Escape (salvo mientras guarda o con el buscador de cliente
  // anidado abierto) + atrapar el foco.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !guardando && !showClienteModal) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, guardando, showClienteModal, onClose]);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, dialogRef);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!canchaId) {
      Swal.fire({ icon: "warning", title: "Seleccioná una cancha" });
      return;
    }
    if (!fechaInicio || cantSemanas < 2 || cantSemanas > 52) {
      Swal.fire({
        icon: "warning",
        title: "Datos inválidos",
        text: "Cantidad de semanas debe estar entre 2 y 52.",
      });
      return;
    }
    if (horaFin <= horaInicio) {
      Swal.fire({
        icon: "warning",
        title: "Horario inválido",
        text: "La hora de fin debe ser posterior al inicio.",
      });
      return;
    }
    if (parseDias(diasSemana).length === 0) {
      Swal.fire({
        icon: "warning",
        title: "Seleccioná al menos un día",
        text: "Elegí los días de la semana en los que se repite la reserva.",
      });
      return;
    }
    try {
      setGuardando(true);
      const r = await crearReservaRecurrente({
        CanchaId: canchaId,
        ClienteId: clienteSeleccionado
          ? Number(clienteSeleccionado.ClienteId)
          : null,
        CanchaReservaCliente: clienteSeleccionado ? "" : nombreInvitado,
        fechaInicio,
        diasSemana,
        cantidadSemanas: cantSemanas,
        CanchaReservaHoraInicio: horaInicio,
        CanchaReservaHoraFin: horaFin,
        CanchaReservaMonto: monto,
        CanchaReservaObservacion: observacion,
      });
      // Mostrar resumen y, si hay rechazos, detallarlos.
      const rechazosHtml =
        r.detalle.rechazadas.length > 0
          ? `
            <p class="text-sm text-left mt-3 font-semibold text-amber-700">
              ${r.detalle.rechazadas.length} fecha${
              r.detalle.rechazadas.length === 1 ? "" : "s"
            } no se pudieron reservar:
            </p>
            <ul class="text-xs text-left list-disc list-inside mt-1">
              ${r.detalle.rechazadas
                .map(
                  (x) =>
                    `<li>${formatDateLocal(x.fecha)} — ${x.mensaje}</li>`
                )
                .join("")}
            </ul>
          `
          : "";
      await Swal.fire({
        icon: r.creadas > 0 ? "success" : "warning",
        title: `${r.creadas} reserva${r.creadas === 1 ? "" : "s"} creada${r.creadas === 1 ? "" : "s"}`,
        html: `
          <div class="text-sm text-left">
            <p>Serie #${r.serieId ?? "—"} con ${r.creadas} reserva(s) semanales.</p>
            ${rechazosHtml}
          </div>
        `,
        confirmButtonText: "Cerrar",
      });
      if (r.creadas > 0) onCreada();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.message || "No se pudo crear la serie",
      });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardando) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reserva-recurrente-modal-title"
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-md bg-blue-100 text-blue-700">
              <CalendarDaysIcon className="w-5 h-5" />
            </span>
            <div>
              <h2
                id="reserva-recurrente-modal-title"
                className="text-lg font-semibold text-gray-900"
              >
                Reserva recurrente
              </h2>
              <p className="text-xs text-gray-500">
                Generá una serie de reservas semanales con el mismo horario.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 grid grid-cols-2 gap-3">
          {/* Cancha */}
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Cancha</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
              value={canchaId}
              onChange={(e) => setCanchaId(Number(e.target.value))}
            >
              <option value={0}>— Seleccionar —</option>
              {canchas.map((c) => (
                <option key={c.CanchaId} value={c.CanchaId}>
                  {c.CanchaNombre}
                </option>
              ))}
            </select>
          </div>

          {/* Cliente */}
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">
              Cliente (opcional)
            </label>
            <div className="flex gap-2 items-stretch">
              <button
                type="button"
                onClick={() => setShowClienteModal(true)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-left text-sm bg-white hover:bg-gray-50 cursor-pointer"
              >
                {clienteSeleccionado ? (
                  <span className="font-medium">
                    {clienteSeleccionado.ClienteNombre}{" "}
                    {clienteSeleccionado.ClienteApellido ?? ""}
                  </span>
                ) : (
                  <span className="text-gray-500">
                    — Invitado/externo —{" "}
                    <span className="text-blue-600 underline">
                      Buscar cliente
                    </span>
                  </span>
                )}
              </button>
              {clienteSeleccionado && (
                <button
                  type="button"
                  onClick={() => setClienteSeleccionado(null)}
                  className="px-3 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
                >
                  Quitar
                </button>
              )}
            </div>
          </div>

          {!clienteSeleccionado && (
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">
                Nombre (si es invitado)
              </label>
              <input
                type="text"
                value={nombreInvitado}
                onChange={(e) => setNombreInvitado(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Ej. Empresa X / Grupo de futbol L 19hs"
              />
            </div>
          )}

          {/* Patrón */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Primera fecha
            </label>
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
            />
            {fechaInicio && (
              <p className="mt-1 text-xs text-gray-500">
                Inicia un <strong>{diaSemanaDe(fechaInicio)}</strong> (no se
                crean fechas anteriores)
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Cantidad de semanas
            </label>
            <input
              type="number"
              min={2}
              max={52}
              value={cantSemanas}
              onChange={(e) =>
                setCantSemanas(Math.max(2, Math.min(52, Number(e.target.value) || 0)))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          {/* Días de la semana */}
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-2">
              Días de la semana
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {DIAS.map((d) => {
                const activo = parseDias(diasSemana).includes(d.sigla);
                return (
                  <button
                    key={d.sigla}
                    type="button"
                    onClick={() => toggleDia(d.sigla)}
                    className={`px-3 py-1.5 text-sm rounded-md border cursor-pointer transition-colors ${
                      activo
                        ? "bg-blue-600 text-white border-blue-700"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDiasShortcut("todos")}
                className="text-blue-600 hover:underline cursor-pointer"
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setDiasShortcut("habiles")}
                className="text-blue-600 hover:underline cursor-pointer"
              >
                Lun-Vie
              </button>
              <button
                type="button"
                onClick={() => setDiasShortcut("finde")}
                className="text-blue-600 hover:underline cursor-pointer"
              >
                Sáb-Dom
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Hora inicio
            </label>
            <input
              type="time"
              value={horaInicio}
              onChange={(e) => setHoraInicio(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
            <input
              type="time"
              value={horaFin}
              onChange={(e) => setHoraFin(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Monto por reserva
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={monto ? formatMiles(monto) : ""}
              placeholder="0"
              onChange={(e) => {
                const raw = e.target.value
                  .replace(/\./g, "")
                  .replace(/\s/g, "");
                if (raw === "") {
                  setMonto(0);
                  return;
                }
                const n = Number(raw);
                if (!isNaN(n)) setMonto(n);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-right tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Observación
            </label>
            <input
              type="text"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              maxLength={255}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Opcional"
            />
          </div>

          {/* Preview */}
          <div className="col-span-2 mt-2">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p className="text-xs text-blue-900 font-medium mb-2">
                Se van a generar {fechasPreview.length} reservas:
              </p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {fechasPreview.slice(0, 12).map((f) => (
                  <span
                    key={f}
                    className="px-2 py-0.5 bg-white border border-blue-200 rounded text-blue-900 tabular-nums"
                  >
                    {formatDateLocal(f)}
                  </span>
                ))}
                {fechasPreview.length > 12 && (
                  <span className="px-2 py-0.5 text-blue-700">
                    + {fechasPreview.length - 12} más
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-blue-800">
                Cada fecha se valida individualmente contra bloqueos y otras
                reservas. Si alguna choca, se reporta y las demás se crean igual.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={guardando}
            className="cursor-pointer"
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={guardando || !canchaId || fechasPreview.length < 2}
            className="cursor-pointer"
          >
            {guardando
              ? "Generando..."
              : `Crear ${fechasPreview.length} reservas`}
          </Button>
        </div>
      </div>

      <ClienteModal
        show={showClienteModal}
        onClose={() => setShowClienteModal(false)}
        clientes={clientes}
        onSelect={(c) => {
          setClienteSeleccionado(c);
          setShowClienteModal(false);
        }}
      />
    </div>
  );
}
