import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import {
  PrinterIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import {
  getCanchasActivas,
  getReservasPorFecha,
  getReservasPorRango,
  updateReserva,
  type Cancha,
  type CanchaReserva,
} from "../../services/cancha.service";
import { getAllClientesSinPaginacion } from "../../services/clientes.service";
import { getConfiguracion } from "../../services/configuracion.service";
import {
  getReporteCanchaHeatmap,
  type ReporteHeatmapResponse,
} from "../../services/reportes.service";
import { usePermiso } from "../../hooks/usePermiso";
import {
  Button,
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
} from "../../components/common/ui";
import { addDaysLocal, formatMiles, todayLocalISO } from "../../utils/utils";
import ReservaFormModal, {
  type ReservaFormInitial,
} from "../../components/cancha/ReservaFormModal";
import { generarPDFReservasDia } from "../../utils/pdfReservasDia";
import { generarPDFReservasSemana } from "../../utils/pdfReservasSemana";
import type { Cliente as ClienteOpt } from "../../components/common/ClienteFormModal";

// Configuración del grid: slots de 30 minutos. HORA_INICIO/HORA_FIN se leen
// vivos desde `configuracion` (CANCHA_HORA_INICIO / CANCHA_HORA_FIN).
const DEFAULT_HORA_INICIO = 6;
const DEFAULT_HORA_FIN = 23;
const SLOTS_POR_HORA = 2;
const SLOT_HEIGHT = 28; // px por slot de 30 min

const ESTADO_LABELS: Record<
  string,
  { label: string; bg: string; border: string; text: string }
> = {
  R: {
    label: "Reservada",
    bg: "bg-amber-100",
    border: "border-amber-400",
    text: "text-amber-900",
  },
  P: {
    label: "Pagada",
    bg: "bg-green-100",
    border: "border-green-400",
    text: "text-green-900",
  },
  X: {
    label: "Cancelada",
    bg: "bg-gray-100",
    border: "border-gray-300",
    text: "text-gray-500",
  },
};

// Convierte un timestamp del backend (ISO con Z) a HH:MM local del navegador.
function tsToHHMM(ts: string): string {
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

function hhmmToSlot(hhmm: string, horaInicio: number): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h - horaInicio) * SLOTS_POR_HORA + Math.floor(m / 30);
}

function slotToHHMM(slot: number, horaInicio: number): string {
  const totalMin = horaInicio * 60 + slot * 30;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Devuelve el lunes de la semana que contiene la fecha ISO dada.
function lunesDeSemana(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("T")[0].split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dia = dt.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
  const diff = dia === 0 ? -6 : 1 - dia; // mover al lunes
  dt.setDate(dt.getDate() + diff);
  return dt;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

const DIAS_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

type Vista = "dia" | "semana" | "mes";

// Devuelve las fechas (en orden) que forman la grilla del mes: incluye los
// días "fuera" del mes que rellenan la primera y última semana para que la
// grilla sea siempre rectangular de 7 columnas. Lunes-iniciado.
function fechasGridMes(anio: number, mes: number): string[] {
  const primero = new Date(anio, mes - 1, 1);
  const ultimo = new Date(anio, mes, 0); // día 0 del mes siguiente = último del actual
  // Inicio: lunes de la semana del primer día
  const inicio = new Date(primero);
  const diaInicio = primero.getDay(); // 0=Dom..6=Sab
  const shift = diaInicio === 0 ? -6 : 1 - diaInicio;
  inicio.setDate(primero.getDate() + shift);
  // Fin: domingo de la semana del último día
  const fin = new Date(ultimo);
  const diaFin = ultimo.getDay();
  const shiftFin = diaFin === 0 ? 0 : 7 - diaFin;
  fin.setDate(ultimo.getDate() + shiftFin);

  const res: string[] = [];
  const cur = new Date(inicio);
  while (cur <= fin) {
    res.push(toISODate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return res;
}

export default function CanchaCalendarioPage() {
  const puedeLeer = usePermiso("CANCHA", "leer");
  const puedeCrear = usePermiso("CANCHA", "crear");
  const puedeEditar = usePermiso("CANCHA", "editar");
  const puedeEliminar = usePermiso("CANCHA", "eliminar");

  const [fecha, setFecha] = useState(todayLocalISO());
  const [vista, setVista] = useState<Vista>("dia");
  const [canchaSemanaId, setCanchaSemanaId] = useState<number>(0);
  // En vista mes el filtro es opcional: null = todas las canchas (agregado),
  // número = filtra el bucketing por esa cancha.
  const [canchaMesId, setCanchaMesId] = useState<number | null>(null);
  // Heatmap historial: overlay sobre slots vacíos del grid (día/semana).
  // Se calcula sobre el mes actual y se respeta el filtro de cancha activo.
  const [heatmapEnabled, setHeatmapEnabled] = useState(true);
  const [heatmapData, setHeatmapData] = useState<ReporteHeatmapResponse | null>(
    null
  );
  const [horaInicio, setHoraInicio] = useState(DEFAULT_HORA_INICIO);
  const [horaFinOp, setHoraFinOp] = useState(DEFAULT_HORA_FIN);
  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [reservas, setReservas] = useState<CanchaReserva[]>([]);
  const [reservasSemana, setReservasSemana] = useState<
    Record<string, CanchaReserva[]>
  >({});
  const [reservasMes, setReservasMes] = useState<Record<string, CanchaReserva[]>>(
    {}
  );
  const [clientes, setClientes] = useState<ClienteOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [initial, setInitial] = useState<ReservaFormInitial | undefined>(
    undefined
  );
  const [generandoPDF, setGenerandoPDF] = useState(false);

  // Estado del drag-resize del borde inferior de un bloque de reserva.
  // Solo vista DÍA por ahora; vista semana puede sumarse después si conviene.
  const [dragState, setDragState] = useState<{
    reservaId: number;
    canchaId: number;
    fechaSlot: string;
    startSlot: number;
    originalEndSlot: number;
    currentEndSlot: number;
    startY: number;
  } | null>(null);

  // Las 7 fechas (lun a dom) de la semana que contiene `fecha`.
  const fechasSemana = useMemo(() => {
    const lun = lunesDeSemana(fecha);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(lun);
      d.setDate(d.getDate() + i);
      return toISODate(d);
    });
  }, [fecha]);

  // Fechas de la grilla del mes (incluye días fuera del mes para grilla rectangular).
  const fechasMes = useMemo(() => {
    const [y, m] = fecha.split("-").map(Number);
    return fechasGridMes(y, m);
  }, [fecha]);

  // Año/mes derivados de `fecha` (para fetch del heatmap mensual).
  const mesActualKey = fecha.slice(0, 7); // "YYYY-MM"

  // Carga del heatmap: depende del mes seleccionado, la vista y el filtro de
  // cancha. Para vista día/semana usamos el filtro correspondiente.
  useEffect(() => {
    if (!puedeLeer) return;
    if (vista === "mes") return; // en vista mes no aplicamos overlay
    const [y, m] = mesActualKey.split("-").map(Number);
    const canchaIdFiltro =
      vista === "semana"
        ? canchaSemanaId || null
        : null; // día: sin filtro (todas las canchas suman al heatmap)
    let cancelado = false;
    (async () => {
      try {
        const r = await getReporteCanchaHeatmap(y, m, canchaIdFiltro);
        if (!cancelado) setHeatmapData(r);
      } catch {
        if (!cancelado) setHeatmapData(null);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [puedeLeer, mesActualKey, vista, canchaSemanaId]);

  // Lookup rápido por "dia-hora" + máximo para escalar la intensidad.
  const { heatmapLookup, heatmapMax } = useMemo(() => {
    if (!heatmapData)
      return { heatmapLookup: new Map<string, number>(), heatmapMax: 0 };
    const lookup = new Map<string, number>();
    let max = 0;
    for (const c of heatmapData.matriz) {
      lookup.set(`${c.dia}-${c.hora}`, c.reservas);
      if (c.reservas > max) max = c.reservas;
    }
    return { heatmapLookup: lookup, heatmapMax: max };
  }, [heatmapData]);

  // Día de semana 0=Lun..6=Dom para una fecha ISO.
  const diaSemanaDeFecha = (fechaISO: string): number => {
    const [y, m, d] = fechaISO.split("-").map(Number);
    const js = new Date(y, m - 1, d).getDay();
    return js === 0 ? 6 : js - 1;
  };

  // Devuelve la clase de fondo del slot según intensidad relativa del heatmap.
  const heatmapBgClass = (diaSemana: number, hora: number): string => {
    if (!heatmapEnabled || heatmapMax === 0) return "";
    const n = heatmapLookup.get(`${diaSemana}-${hora}`) || 0;
    if (n === 0) return "";
    const pct = n / heatmapMax;
    if (pct < 0.25) return "bg-amber-50";
    if (pct < 0.5) return "bg-amber-100";
    if (pct < 0.75) return "bg-amber-200";
    return "bg-amber-300";
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const cR = await getCanchasActivas();
      setCanchas(cR.data);
      if (vista === "dia") {
        const rR = await getReservasPorFecha(fecha);
        setReservas(rR.data);
      } else if (vista === "semana") {
        // Vista semana: 7 fetches en paralelo, indexamos por fecha.
        const respuestas = await Promise.all(
          fechasSemana.map((f) => getReservasPorFecha(f))
        );
        const map: Record<string, CanchaReserva[]> = {};
        fechasSemana.forEach((f, i) => {
          map[f] = respuestas[i].data;
        });
        setReservasSemana(map);
      } else {
        // Vista mes: una sola query por rango y bucketing en el frontend.
        const desde = fechasMes[0];
        const hasta = fechasMes[fechasMes.length - 1];
        const r = await getReservasPorRango(desde, hasta);
        const map: Record<string, CanchaReserva[]> = {};
        for (const res of r.data) {
          const k = (res.CanchaReservaFecha || "").slice(0, 10);
          if (!map[k]) map[k] = [];
          map[k].push(res);
        }
        setReservasMes(map);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cargar el calendario");
    } finally {
      setLoading(false);
    }
  }, [fecha, vista, fechasSemana, fechasMes]);

  useEffect(() => {
    if (!puedeLeer) return;
    fetchData();
  }, [puedeLeer, fetchData]);

  useEffect(() => {
    if (!puedeLeer) return;
    (async () => {
      try {
        const cl = await getAllClientesSinPaginacion();
        // El service devuelve `{ data: Cliente[] }`. Sin extraer .data, el
        // setState deja `clientes` como objeto wrapper y `.find()` revienta.
        setClientes(cl?.data || []);
      } catch {
        /* silenciar; el select queda vacio */
      }
      // Cargar horario operativo desde configuracion. Si las claves no existen
      // o no son numericas, dejamos los defaults.
      try {
        const [hi, hf] = await Promise.all([
          getConfiguracion("CANCHA_HORA_INICIO").catch(() => null),
          getConfiguracion("CANCHA_HORA_FIN").catch(() => null),
        ]);
        const hiNum = hi ? Number(hi.ConfigValor) : NaN;
        const hfNum = hf ? Number(hf.ConfigValor) : NaN;
        if (Number.isFinite(hiNum) && Number.isFinite(hfNum) && hfNum > hiNum) {
          setHoraInicio(hiNum);
          setHoraFinOp(hfNum);
        }
      } catch {
        /* defaults */
      }
    })();
  }, [puedeLeer]);

  // Slots totales basados en el horario operativo actual.
  const TOTAL_SLOTS = (horaFinOp - horaInicio) * SLOTS_POR_HORA;

  // Listener global de mouse para el drag-resize. Se monta solo cuando hay
  // un drag activo. Snap a slot de 30 min y commit al soltar.
  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragState.startY;
      const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
      let newEndSlot = dragState.originalEndSlot + deltaSlots;
      // Mínimo 30 min (1 slot por encima del inicio); máximo TOTAL_SLOTS.
      newEndSlot = Math.max(dragState.startSlot + 1, newEndSlot);
      newEndSlot = Math.min(TOTAL_SLOTS, newEndSlot);
      if (newEndSlot !== dragState.currentEndSlot) {
        setDragState({ ...dragState, currentEndSlot: newEndSlot });
      }
    };
    const onUp = async () => {
      const finalState = dragState;
      setDragState(null);
      if (finalState.currentEndSlot === finalState.originalEndSlot) return;
      const horaInicioStr = slotToHHMM(finalState.startSlot, horaInicio);
      const horaFinStr = slotToHHMM(finalState.currentEndSlot, horaInicio);
      try {
        await updateReserva(finalState.reservaId, {
          CanchaId: finalState.canchaId,
          CanchaReservaFecha: finalState.fechaSlot,
          CanchaReservaHoraInicio: `${finalState.fechaSlot} ${horaInicioStr}:00`,
          CanchaReservaHoraFin: `${finalState.fechaSlot} ${horaFinStr}:00`,
        });
        fetchData();
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        if (err?.code === "CONFLICTO_HORARIO") {
          Swal.fire({
            icon: "warning",
            title: "Horario ocupado",
            text:
              err.message ||
              "No se pudo extender: choca con otra reserva.",
          });
        } else {
          Swal.fire({
            icon: "error",
            title: "Error",
            text: err?.message || "No se pudo actualizar el horario",
          });
        }
        fetchData(); // recarga para revertir el estado visual
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState, horaInicio, TOTAL_SLOTS, fetchData]);

  // Al cambiar a vista semana, si todavía no hay cancha seleccionada, elegimos
  // la primera activa.
  useEffect(() => {
    if (vista === "semana" && !canchaSemanaId && canchas.length > 0) {
      setCanchaSemanaId(canchas[0].CanchaId);
    }
  }, [vista, canchaSemanaId, canchas]);

  const reservasPorCancha = useMemo(() => {
    const m = new Map<number, CanchaReserva[]>();
    for (const r of reservas) {
      if (!m.has(r.CanchaId)) m.set(r.CanchaId, []);
      m.get(r.CanchaId)!.push(r);
    }
    return m;
  }, [reservas]);

  const handleSlotClick = (cancha: Cancha, slot: number, fechaSlot?: string) => {
    if (!puedeCrear) return;
    const hi = slotToHHMM(slot, horaInicio);
    const hf = slotToHHMM(
      Math.min(slot + SLOTS_POR_HORA, TOTAL_SLOTS),
      horaInicio
    );
    setInitial({
      CanchaId: cancha.CanchaId,
      CanchaReservaFecha: fechaSlot || fecha,
      CanchaReservaHoraInicio: hi,
      CanchaReservaHoraFin: hf,
      CanchaReservaMonto: 0, // el modal lo llena solo con la tarifa sugerida
    });
    setModalOpen(true);
  };

  // Trae el nombre del gimnasio una sola vez (lo usan ambos PDFs).
  const obtenerNombreGimnasio = async (): Promise<string> => {
    try {
      const cfg = await getConfiguracion("GIMNASIO_NOMBRE");
      if (cfg?.ConfigValor) return cfg.ConfigValor;
    } catch {
      /* fallback */
    }
    return "GIMNASIO";
  };

  // PDF diario: usado en vista "Día".
  const handleImprimirPDF = async () => {
    if (generandoPDF) return;
    try {
      setGenerandoPDF(true);
      const nombreGimnasio = await obtenerNombreGimnasio();
      await generarPDFReservasDia({
        fecha,
        canchas,
        reservas,
        nombreGimnasio,
      });
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "No se pudo generar el PDF",
        text: e instanceof Error ? e.message : "Error inesperado",
      });
    } finally {
      setGenerandoPDF(false);
    }
  };

  // PDF semanal: usado en vista "Semana" — solo la cancha seleccionada.
  const handleImprimirSemanaPDF = async () => {
    if (generandoPDF) return;
    const canchaSel = canchas.find((c) => c.CanchaId === canchaSemanaId);
    if (!canchaSel) return;
    try {
      setGenerandoPDF(true);
      const nombreGimnasio = await obtenerNombreGimnasio();
      await generarPDFReservasSemana({
        cancha: canchaSel,
        fechas: fechasSemana,
        reservasPorFecha: reservasSemana,
        nombreGimnasio,
      });
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "No se pudo generar el PDF",
        text: e instanceof Error ? e.message : "Error inesperado",
      });
    } finally {
      setGenerandoPDF(false);
    }
  };

  const handleReservaClick = (r: CanchaReserva) => {
    setInitial({
      CanchaReservaId: r.CanchaReservaId,
      CanchaId: r.CanchaId,
      ClienteId: r.ClienteId ?? null,
      CanchaReservaCliente: r.CanchaReservaCliente || "",
      CanchaReservaFecha: r.CanchaReservaFecha?.slice(0, 10) || fecha,
      CanchaReservaHoraInicio: tsToHHMM(r.CanchaReservaHoraInicio),
      CanchaReservaHoraFin: tsToHHMM(r.CanchaReservaHoraFin),
      CanchaReservaMonto: r.CanchaReservaMonto || 0,
      CanchaReservaEstado: r.CanchaReservaEstado || "R",
      CanchaReservaObservacion: r.CanchaReservaObservacion || "",
    });
    setModalOpen(true);
  };

  if (!puedeLeer) return <PermissionDenied resource="el calendario de canchas" />;

  const hourLabels = Array.from({ length: horaFinOp - horaInicio }).map(
    (_, i) => horaInicio + i
  );

  return (
    <div className="p-4 sm:p-6">
      <Card>
        <CardHeader
          title="Cancha — Calendario"
          description="Vista diaria de disponibilidad. Hacé click en un horario libre para crear una reserva, o en una reserva existente para editarla."
          actions={
            <div className="flex items-center gap-3">
              {vista !== "mes" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={
                    vista === "dia"
                      ? handleImprimirPDF
                      : handleImprimirSemanaPDF
                  }
                  disabled={
                    generandoPDF ||
                    (vista === "dia" && reservas.length === 0) ||
                    (vista === "semana" && !canchaSemanaId)
                  }
                  className="cursor-pointer inline-flex items-center gap-1.5"
                  title={
                    vista === "dia"
                      ? "PDF con todas las canchas del día"
                      : "PDF con la cancha seleccionada en las 7 fechas"
                  }
                >
                  <PrinterIcon className="w-4 h-4" />
                  {generandoPDF
                    ? "Generando..."
                    : vista === "dia"
                    ? "Imprimir día"
                    : "Imprimir semana"}
                </Button>
              )}
              <Link
                to="/cancha"
                className="text-sm text-blue-700 hover:underline cursor-pointer"
              >
                Ver lista →
              </Link>
            </div>
          }
        />

        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <label
              htmlFor="filtro-fecha-calendario"
              className="text-sm font-medium text-blue-900 whitespace-nowrap"
            >
              Fecha:
            </label>
            <button
              type="button"
              onClick={() => setFecha(addDaysLocal(fecha, -1))}
              className="flex items-center justify-center w-8 h-8 rounded-md bg-white border border-blue-300 text-blue-700 hover:bg-blue-100 cursor-pointer focus:ring-2 focus:ring-blue-400 focus:outline-none"
              title="Día anterior"
              aria-label="Día anterior"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <input
              id="filtro-fecha-calendario"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="bg-white border border-blue-300 text-base font-semibold text-blue-900 rounded-md px-3 py-1.5 cursor-pointer focus:ring-2 focus:ring-blue-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setFecha(addDaysLocal(fecha, 1))}
              className="flex items-center justify-center w-8 h-8 rounded-md bg-white border border-blue-300 text-blue-700 hover:bg-blue-100 cursor-pointer focus:ring-2 focus:ring-blue-400 focus:outline-none"
              title="Día siguiente"
              aria-label="Día siguiente"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
            {fecha !== todayLocalISO() && (
              <button
                type="button"
                onClick={() => setFecha(todayLocalISO())}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 underline cursor-pointer ml-1"
              >
                Ir a hoy
              </button>
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {/* Toggle vista */}
            <div className="inline-flex bg-gray-100 rounded-lg p-1 border border-gray-200">
              {(["dia", "semana", "mes"] as Vista[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVista(v)}
                  className={`px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors capitalize ${
                    vista === v
                      ? "bg-white shadow-sm font-semibold text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
                </button>
              ))}
            </div>

            {/* Selector de cancha (solo vista semana) */}
            {vista === "semana" && canchas.length > 0 && (
              <select
                className="bg-white border border-gray-300 text-sm rounded-md px-3 py-1.5 cursor-pointer"
                value={canchaSemanaId}
                onChange={(e) => setCanchaSemanaId(Number(e.target.value))}
              >
                {canchas.map((c) => (
                  <option key={c.CanchaId} value={c.CanchaId}>
                    {c.CanchaNombre}
                  </option>
                ))}
              </select>
            )}

            {/* Filtro opcional de cancha (vista mes) */}
            {vista === "mes" && canchas.length > 1 && (
              <select
                className="bg-white border border-gray-300 text-sm rounded-md px-3 py-1.5 cursor-pointer"
                value={canchaMesId ?? ""}
                onChange={(e) =>
                  setCanchaMesId(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
              >
                <option value="">Todas las canchas</option>
                {canchas.map((c) => (
                  <option key={c.CanchaId} value={c.CanchaId}>
                    {c.CanchaNombre}
                  </option>
                ))}
              </select>
            )}

            {/* Toggle heatmap (solo en vistas día/semana) */}
            {vista !== "mes" && (
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={heatmapEnabled}
                  onChange={(e) => setHeatmapEnabled(e.target.checked)}
                  className="cursor-pointer"
                />
                <span className="text-gray-700 font-medium">Heatmap</span>
                {heatmapEnabled && heatmapMax > 0 && (
                  <div className="flex items-center gap-0.5">
                    <span className="text-gray-500 text-[10px]">menos</span>
                    {["bg-amber-50", "bg-amber-100", "bg-amber-200", "bg-amber-300"].map(
                      (c) => (
                        <span
                          key={c}
                          className={`inline-block w-3 h-3 ${c} border border-amber-300`}
                        />
                      )
                    )}
                    <span className="text-gray-500 text-[10px]">más</span>
                  </div>
                )}
              </label>
            )}

            <div className="flex items-center gap-3 text-xs">
              {Object.entries(ESTADO_LABELS).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span
                    className={`inline-block w-3 h-3 rounded ${v.bg} border ${v.border}`}
                  />
                  <span className="text-gray-600">{v.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && canchas.length === 0 && (
          <div className="p-6 text-center text-gray-500">
            No hay canchas activas. Andá a{" "}
            <Link to="/canchas" className="text-blue-600 underline">
              Catálogo
            </Link>{" "}
            para agregar una.
          </div>
        )}

        {!loading && !error && canchas.length > 0 && vista === "dia" && (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `70px repeat(${canchas.length}, minmax(160px, 1fr))`,
                gridTemplateRows: `36px repeat(${TOTAL_SLOTS}, ${SLOT_HEIGHT}px)`,
              }}
            >
              <div
                style={{ gridColumn: 1, gridRow: 1 }}
                className="bg-gray-50 border-b border-r border-gray-200"
              />

              {canchas.map((c, ci) => (
                <div
                  key={`hdr-${c.CanchaId}`}
                  style={{ gridColumn: ci + 2, gridRow: 1 }}
                  className="bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 flex items-center justify-between"
                >
                  <span>{c.CanchaNombre}</span>
                  {c.CanchaTarifaHora > 0 && (
                    <span className="text-xs font-normal text-gray-500">
                      Gs. {formatMiles(c.CanchaTarifaHora)}/h
                    </span>
                  )}
                </div>
              ))}

              {hourLabels.map((h, idx) => (
                <div
                  key={`hh-${h}`}
                  style={{
                    gridColumn: 1,
                    gridRow: `${idx * SLOTS_POR_HORA + 2} / span ${SLOTS_POR_HORA}`,
                  }}
                  className="border-b border-r border-gray-200 px-2 py-1 text-xs text-gray-500 tabular-nums flex items-start justify-end"
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}

              {(() => {
                // Heatmap del día actual: día de semana único.
                const diaSem = diaSemanaDeFecha(fecha);
                return canchas.flatMap((c, ci) =>
                  Array.from({ length: TOTAL_SLOTS }).map((_, s) => {
                    const esMediaHora = s % 2 === 1;
                    const hora = horaInicio + Math.floor(s / 2);
                    const hmBg = heatmapBgClass(diaSem, hora);
                    return (
                      <div
                        key={`slot-${ci}-${s}`}
                        style={{ gridColumn: ci + 2, gridRow: s + 2 }}
                        className={`${hmBg} border-r border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors ${
                          esMediaHora
                            ? "border-b border-dashed border-gray-100"
                            : "border-b border-gray-200"
                        }`}
                        onClick={() => handleSlotClick(c, s)}
                        title={`${c.CanchaNombre} — ${slotToHHMM(s, horaInicio)}`}
                      />
                    );
                  })
                );
              })()}

              {canchas.flatMap((c, ci) =>
                (reservasPorCancha.get(c.CanchaId) || []).map((r) => {
                  const hi = tsToHHMM(r.CanchaReservaHoraInicio);
                  const hf = tsToHHMM(r.CanchaReservaHoraFin);
                  const startSlot = hhmmToSlot(hi, horaInicio);
                  const endSlot = hhmmToSlot(hf, horaInicio);
                  if (endSlot <= startSlot) return null;
                  // Si esta reserva esta siendo arrastrada, usar el end slot
                  // visual del drag (efecto en vivo).
                  const arrastrando =
                    dragState?.reservaId === r.CanchaReservaId;
                  const effectiveEndSlot = arrastrando
                    ? dragState.currentEndSlot
                    : endSlot;
                  const visualStart = Math.max(0, startSlot);
                  const visualEnd = Math.min(TOTAL_SLOTS, effectiveEndSlot);
                  if (visualEnd <= visualStart) return null;
                  const estilo =
                    ESTADO_LABELS[r.CanchaReservaEstado] || ESTADO_LABELS.R;
                  const cliente = r.ClienteNombre
                    ? `${r.ClienteNombre} ${r.ClienteApellido ?? ""}`.trim()
                    : r.CanchaReservaCliente || "Reserva";
                  const puedeDragear =
                    puedeEditar && r.CanchaReservaEstado !== "X";
                  const hfActual = arrastrando
                    ? slotToHHMM(dragState.currentEndSlot, horaInicio)
                    : hf;
                  return (
                    <div
                      key={`res-${r.CanchaReservaId}`}
                      style={{
                        gridColumn: ci + 2,
                        gridRow: `${visualStart + 2} / ${visualEnd + 2}`,
                      }}
                      className={`m-0.5 rounded border-l-4 ${estilo.bg} ${estilo.border} ${estilo.text} text-xs overflow-hidden hover:shadow-md transition-shadow relative z-10 group ${
                        r.CanchaReservaEstado === "X"
                          ? "opacity-60 line-through"
                          : ""
                      } ${arrastrando ? "ring-2 ring-blue-400 shadow-lg" : ""}`}
                      title={`${cliente} — ${hi} a ${hfActual} — Gs. ${formatMiles(r.CanchaReservaMonto)}`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (dragState) return; // ignorar clicks durante drag
                          handleReservaClick(r);
                        }}
                        className="block w-full text-left px-2 py-1 cursor-pointer"
                      >
                        <div className="font-semibold truncate">{cliente}</div>
                        <div className="opacity-80 tabular-nums">
                          {hi} — {hfActual}
                        </div>
                        {r.CanchaReservaMonto > 0 && (
                          <div className="opacity-70 text-[10px] tabular-nums">
                            Gs. {formatMiles(r.CanchaReservaMonto)}
                          </div>
                        )}
                      </button>
                      {puedeDragear && (
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragState({
                              reservaId: r.CanchaReservaId,
                              canchaId: r.CanchaId,
                              fechaSlot:
                                r.CanchaReservaFecha?.slice(0, 10) || fecha,
                              startSlot,
                              originalEndSlot: endSlot,
                              currentEndSlot: endSlot,
                              startY: e.clientY,
                            });
                          }}
                          className="absolute left-0 right-0 bottom-0 h-1.5 cursor-ns-resize bg-transparent hover:bg-blue-500/40 group-hover:bg-blue-500/20"
                          title="Arrastrá para cambiar la duración"
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {!loading &&
          !error &&
          canchas.length > 0 &&
          vista === "semana" &&
          canchaSemanaId > 0 && (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `70px repeat(7, minmax(140px, 1fr))`,
                  gridTemplateRows: `48px repeat(${TOTAL_SLOTS}, ${SLOT_HEIGHT}px)`,
                }}
              >
                {/* Esquina vacía */}
                <div
                  style={{ gridColumn: 1, gridRow: 1 }}
                  className="bg-gray-50 border-b border-r border-gray-200"
                />

                {/* Encabezado de cada día */}
                {fechasSemana.map((f, di) => {
                  const [y, m, d] = f.split("-").map(Number);
                  const dt = new Date(y, m - 1, d);
                  const esHoy = f === todayLocalISO();
                  return (
                    <div
                      key={`hdr-${f}`}
                      style={{ gridColumn: di + 2, gridRow: 1 }}
                      className={`border-b border-r border-gray-200 px-2 py-2 text-xs flex flex-col items-center justify-center ${
                        esHoy ? "bg-blue-50" : "bg-gray-50"
                      }`}
                    >
                      <span
                        className={`font-semibold ${
                          esHoy ? "text-blue-700" : "text-gray-700"
                        }`}
                      >
                        {DIAS_LABELS[di]}
                      </span>
                      <span
                        className={`tabular-nums ${
                          esHoy ? "text-blue-600" : "text-gray-500"
                        }`}
                      >
                        {String(dt.getDate()).padStart(2, "0")}/
                        {String(dt.getMonth() + 1).padStart(2, "0")}
                      </span>
                    </div>
                  );
                })}

                {/* Etiquetas de hora (col 1) */}
                {hourLabels.map((h, idx) => (
                  <div
                    key={`hh-w-${h}`}
                    style={{
                      gridColumn: 1,
                      gridRow: `${idx * SLOTS_POR_HORA + 2} / span ${SLOTS_POR_HORA}`,
                    }}
                    className="border-b border-r border-gray-200 px-2 py-1 text-xs text-gray-500 tabular-nums flex items-start justify-end"
                  >
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}

                {/* Celdas vacías clickeables (día × slot) */}
                {fechasSemana.flatMap((f, di) => {
                  // En vista semana, cada columna es un día distinto. Como las
                  // fechasSemana siempre van de Lun a Dom, di == diaSemana.
                  const diaSem = di;
                  return Array.from({ length: TOTAL_SLOTS }).map((_, s) => {
                    const esMediaHora = s % 2 === 1;
                    const canchaSel = canchas.find(
                      (c) => c.CanchaId === canchaSemanaId
                    );
                    const hora = horaInicio + Math.floor(s / 2);
                    const hmBg = heatmapBgClass(diaSem, hora);
                    return (
                      <div
                        key={`wslot-${di}-${s}`}
                        style={{ gridColumn: di + 2, gridRow: s + 2 }}
                        className={`${hmBg} border-r border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors ${
                          esMediaHora
                            ? "border-b border-dashed border-gray-100"
                            : "border-b border-gray-200"
                        }`}
                        onClick={() => {
                          if (!canchaSel) return;
                          handleSlotClick(canchaSel, s, f);
                        }}
                        title={`${DIAS_LABELS[di]} ${f} — ${slotToHHMM(s, horaInicio)}`}
                      />
                    );
                  });
                })}

                {/* Bloques de reserva para la cancha seleccionada */}
                {fechasSemana.flatMap((f, di) => {
                  const reservasDia = (reservasSemana[f] || []).filter(
                    (r) => r.CanchaId === canchaSemanaId
                  );
                  return reservasDia.map((r) => {
                    const hi = tsToHHMM(r.CanchaReservaHoraInicio);
                    const hf = tsToHHMM(r.CanchaReservaHoraFin);
                    const startSlot = hhmmToSlot(hi, horaInicio);
                    const endSlot = hhmmToSlot(hf, horaInicio);
                    if (endSlot <= startSlot) return null;
                    const visualStart = Math.max(0, startSlot);
                    const visualEnd = Math.min(TOTAL_SLOTS, endSlot);
                    if (visualEnd <= visualStart) return null;
                    const estilo =
                      ESTADO_LABELS[r.CanchaReservaEstado] || ESTADO_LABELS.R;
                    const cliente = r.ClienteNombre
                      ? `${r.ClienteNombre} ${r.ClienteApellido ?? ""}`.trim()
                      : r.CanchaReservaCliente || "Reserva";
                    return (
                      <button
                        key={`wres-${r.CanchaReservaId}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReservaClick(r);
                        }}
                        style={{
                          gridColumn: di + 2,
                          gridRow: `${visualStart + 2} / ${visualEnd + 2}`,
                        }}
                        className={`m-0.5 rounded border-l-4 ${estilo.bg} ${estilo.border} ${estilo.text} px-2 py-1 text-xs text-left overflow-hidden hover:shadow-md transition-shadow cursor-pointer relative z-10 ${
                          r.CanchaReservaEstado === "X"
                            ? "opacity-60 line-through"
                            : ""
                        }`}
                        title={`${cliente} — ${hi} a ${hf} — Gs. ${formatMiles(r.CanchaReservaMonto)}`}
                      >
                        <div className="font-semibold truncate">{cliente}</div>
                        <div className="opacity-80 tabular-nums">
                          {hi} — {hf}
                        </div>
                      </button>
                    );
                  });
                })}
              </div>
            </div>
          )}

        {!loading && !error && vista === "mes" && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Header con nombres de días de semana */}
            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
              {DIAS_LABELS.map((d) => (
                <div
                  key={`mh-${d}`}
                  className="px-3 py-2 text-xs font-semibold text-gray-700 text-center"
                >
                  {d}
                </div>
              ))}
            </div>
            {/* Grid de días */}
            <div className="grid grid-cols-7">
              {fechasMes.map((f) => {
                const [yy, mm, dd] = f.split("-").map(Number);
                const dt = new Date(yy, mm - 1, dd);
                const esMesActual = mm === Number(fecha.split("-")[1]);
                const esHoy = f === todayLocalISO();
                const listaRaw = reservasMes[f] || [];
                // Filtro opcional por cancha en vista mes.
                const lista = canchaMesId
                  ? listaRaw.filter((r) => r.CanchaId === canchaMesId)
                  : listaRaw;
                const activas = lista.filter(
                  (r) => r.CanchaReservaEstado !== "X"
                );
                const pagadas = activas.filter(
                  (r) => r.CanchaReservaEstado === "P"
                );
                const reservadas = activas.filter(
                  (r) => r.CanchaReservaEstado === "R"
                );
                const totalIngreso = activas.reduce(
                  (a, r) => a + Number(r.CanchaReservaMonto || 0),
                  0
                );
                // Heatmap: intensidad de fondo según cantidad de activas.
                const intensidad =
                  activas.length === 0
                    ? "bg-white"
                    : activas.length <= 2
                    ? "bg-blue-50"
                    : activas.length <= 5
                    ? "bg-blue-100"
                    : activas.length <= 10
                    ? "bg-blue-200"
                    : "bg-blue-300";
                return (
                  <button
                    key={`md-${f}`}
                    type="button"
                    onClick={() => {
                      setFecha(f);
                      setVista("dia");
                    }}
                    className={`relative border-r border-b border-gray-200 p-2 text-left min-h-[90px] cursor-pointer transition-colors hover:ring-2 hover:ring-blue-300 ${
                      esMesActual ? intensidad : "bg-gray-50 text-gray-400"
                    } ${esHoy ? "ring-2 ring-blue-500" : ""}`}
                    title={`${activas.length} reserva${activas.length === 1 ? "" : "s"} — Gs. ${formatMiles(totalIngreso)}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-semibold ${
                          esHoy
                            ? "text-blue-700"
                            : esMesActual
                            ? "text-gray-800"
                            : "text-gray-400"
                        }`}
                      >
                        {dt.getDate()}
                      </span>
                      {activas.length > 0 && (
                        <span className="text-[10px] text-gray-600 tabular-nums">
                          {activas.length}
                        </span>
                      )}
                    </div>
                    {activas.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {pagadas.length > 0 && (
                          <div className="text-[10px] text-green-700">
                            ✓ {pagadas.length} pagada{pagadas.length === 1 ? "" : "s"}
                          </div>
                        )}
                        {reservadas.length > 0 && (
                          <div className="text-[10px] text-amber-700">
                            ⏳ {reservadas.length} pendiente
                            {reservadas.length === 1 ? "" : "s"}
                          </div>
                        )}
                        {totalIngreso > 0 && (
                          <div className="text-[10px] text-gray-700 tabular-nums">
                            Gs. {formatMiles(totalIngreso)}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <ReservaFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchData}
        canchas={canchas}
        clientes={clientes}
        initial={initial}
        puedeCrear={puedeCrear}
        puedeEditar={puedeEditar}
        puedeEliminar={puedeEliminar}
      />
    </div>
  );
}
