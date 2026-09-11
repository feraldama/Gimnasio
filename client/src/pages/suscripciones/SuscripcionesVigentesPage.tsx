import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  ArrowDownTrayIcon,
  UserGroupIcon,
  ArrowTrendingUpIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import Swal from "sweetalert2";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,
  StatCard,
} from "../../components/common/ui";
import { usePermiso } from "../../hooks/usePermiso";
import {
  getReporteSuscripcionesVigentes,
  type ReporteSuscripcionesVigentesResponse,
  type SuscripcionVigenteDetalle,
} from "../../services/reportes.service";
import { getPlanes } from "../../services/planes.service";
import { getConfiguracion } from "../../services/configuracion.service";
import { generarPDFSuscripcionesVigentes } from "../../utils/pdfSuscripcionesVigentes";
import {
  addDaysLocal,
  formatDateLocal,
  formatMiles,
  formatMilesWithDecimals,
  todayLocalISO,
} from "../../utils/utils";

/**
 * Reporte de suscripciones vigentes por rango de fechas.
 *
 * LA DISTINCIÓN QUE HACE ÚTIL A ESTA PANTALLA: "vigentes" no es lo mismo que
 * "inscriptos". El reporte de ocupación mensual (Reportes gráficos) cuenta
 * altas — cuántos ENTRARON ese mes. Acá se cuenta el plantel: cuántas
 * suscripciones estaban corriendo, incluidas las que arrancaron meses antes.
 * Un mes con cero altas puede tener trescientos vigentes.
 *
 * Y dentro de "vigentes en un rango" también hay dos números distintos, así
 * que se muestran los dos porque significan cosas diferentes:
 *
 *   - El TOTAL del período: cuántas suscripciones distintas estuvieron
 *     vigentes en algún momento entre las dos fechas. Sirve para facturación
 *     y para dimensionar el movimiento del mes.
 *   - El STOCK de cada día (el gráfico): cuántas había vigentes en una fecha
 *     puntual. Es lo que hay que mirar para capacidad de sala y para
 *     comparar contra el mes anterior. Los puntos del gráfico NO se suman
 *     entre sí; cada uno es una foto.
 */

const ESTADOS: Record<
  string,
  { label: string; tone: "success" | "danger" | "info" | "neutral" | "warning" }
> = {
  A: { label: "Vigente", tone: "success" },
  V: { label: "Vencida", tone: "danger" },
  F: { label: "Futura", tone: "info" },
  C: { label: "Cancelada", tone: "neutral" },
  S: { label: "Suspendida", tone: "warning" },
};

const PASO_LABEL: Record<string, string> = {
  dia: "por día",
  semana: "por semana",
  mes: "por mes",
};

// El backend baja el grano de la serie en rangos largos, así que "promedio" y
// "pico" son sobre los puntos muestreados, no sobre los días. Decirlo evita
// prometer una precisión que no existe: en un rango anual la serie es semanal
// y el día pico real puede caer en una fecha que nunca se muestreó.
const PASO_UNIDAD: Record<string, { promedio: string; pico: string }> = {
  dia: { promedio: "Promedio diario", pico: "pico de" },
  semana: { promedio: "Promedio de las semanas", pico: "mejor semana con" },
  mes: { promedio: "Promedio de los meses", pico: "mejor mes con" },
};

/** Etiqueta del eje X: con paso mensual el año importa, con paso diario no. */
function etiquetaEje(fecha: string, paso: string): string {
  const dmy = formatDateLocal(fecha);
  return paso === "mes" ? dmy.slice(3) : dmy.slice(0, 5);
}

/**
 * Variación contra el período anterior, lista para el `trend` del StatCard.
 *
 * `mejorSiSube` existe porque la flecha verde no siempre significa lo mismo:
 * más socios vigentes es bueno, más vencimientos no. Sin esto, la tarjeta de
 * "Vencen en el período" pintaría de verde un mes con el doble de bajas.
 *
 * Devuelve `undefined` cuando no hay período anterior con qué comparar, para
 * que la tarjeta simplemente no muestre flecha en vez de mostrar un 0% falso.
 */
function variacionVsPrevio(
  actual: number,
  previo: number | undefined,
  mejorSiSube = true
): { direction: "up" | "down" | "flat"; label: string } | undefined {
  if (previo === undefined || previo === null) return undefined;
  const delta = actual - previo;
  if (delta === 0) {
    return { direction: "flat", label: `igual que el período anterior` };
  }
  // Sin base no hay porcentaje que valga: se muestra el absoluto.
  const pct =
    previo > 0 ? ` (${delta > 0 ? "+" : ""}${Math.round((delta / previo) * 100)}%)` : "";
  const subio = delta > 0;
  return {
    direction: (subio ? mejorSiSube : !mejorSiSube) ? "up" : "down",
    label: `${subio ? "+" : ""}${formatMiles(delta)}${pct} vs. período anterior`,
  };
}

interface PlanOpcion {
  PlanId: number;
  PlanNombre: string;
}

/** Rangos de uso frecuente, para no tipear dos fechas en el caso normal. */
function presets(hoy: string) {
  const [y, m] = hoy.split("-").map(Number);
  const primeroMesActual = `${y}-${String(m).padStart(2, "0")}-01`;
  const ultimoMesActual = `${y}-${String(m).padStart(2, "0")}-${String(
    new Date(y, m, 0).getDate()
  ).padStart(2, "0")}`;
  const yAnt = m === 1 ? y - 1 : y;
  const mAnt = m === 1 ? 12 : m - 1;
  const primeroMesAnterior = `${yAnt}-${String(mAnt).padStart(2, "0")}-01`;
  const ultimoMesAnterior = `${yAnt}-${String(mAnt).padStart(2, "0")}-${String(
    new Date(yAnt, mAnt, 0).getDate()
  ).padStart(2, "0")}`;
  return [
    { label: "Este mes", desde: primeroMesActual, hasta: ultimoMesActual },
    { label: "Mes pasado", desde: primeroMesAnterior, hasta: ultimoMesAnterior },
    { label: "Últimos 30 días", desde: addDaysLocal(hoy, -29), hasta: hoy },
    { label: "Este año", desde: `${y}-01-01`, hasta: `${y}-12-31` },
  ];
}

export default function SuscripcionesVigentesPage() {
  const puedeLeer = usePermiso("SUSCRIPCIONES", "leer");
  const hoy = useMemo(() => todayLocalISO(), []);
  const rangosRapidos = useMemo(() => presets(hoy), [hoy]);

  const [fechaDesde, setFechaDesde] = useState(rangosRapidos[0].desde);
  const [fechaHasta, setFechaHasta] = useState(rangosRapidos[0].hasta);
  const [planId, setPlanId] = useState<number | null>(null);
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);

  const [data, setData] = useState<ReporteSuscripcionesVigentesResponse | null>(
    null
  );
  const [planes, setPlanes] = useState<PlanOpcion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generandoPDF, setGenerandoPDF] = useState(false);

  // Filtros de la tabla: se aplican sobre el detalle ya cargado, no vuelven
  // al servidor. El resumen y el gráfico siguen reflejando el rango completo.
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("TODOS");

  const cargar = useCallback(async () => {
    if (!puedeLeer) return;
    // El efecto se dispara con cada cambio de los inputs. Al vaciar un campo
    // de fecha el valor queda en "", y sin este corte se mandaba igual y la
    // pantalla mostraba un error rojo del backend mientras el usuario estaba
    // en la mitad de elegir el rango.
    if (!fechaDesde || !fechaHasta) return;
    if (fechaDesde > fechaHasta) {
      setError("La fecha desde no puede ser posterior a la fecha hasta.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await getReporteSuscripcionesVigentes(
        fechaDesde,
        fechaHasta,
        { planId, incluirCanceladas, limite: 1000, comparar: true }
      );
      setData(resp);
    } catch (e) {
      const err = e as { error?: string; message?: string };
      setError(err.error || err.message || "Error al cargar el reporte");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [puedeLeer, fechaDesde, fechaHasta, planId, incluirCanceladas]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Combo de planes. Best-effort: un perfil con SUSCRIPCIONES pero sin PLANES
  // recibe 403 acá y simplemente no ve el filtro, en vez de romper la página.
  useEffect(() => {
    if (!puedeLeer) return;
    (async () => {
      try {
        const r = await getPlanes(1, 200);
        setPlanes(Array.isArray(r?.data) ? r.data : []);
      } catch {
        /* sin permiso sobre planes: el filtro no se muestra */
      }
    })();
  }, [puedeLeer]);

  const detalleFiltrado = useMemo<SuscripcionVigenteDetalle[]>(() => {
    const filas = data?.detalle || [];
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (estadoFiltro !== "TODOS" && f.estado !== estadoFiltro) return false;
      if (!q) return true;
      return (
        f.socio.toLowerCase().includes(q) ||
        f.ruc.toLowerCase().includes(q) ||
        f.plan.toLowerCase().includes(q)
      );
    });
  }, [data, busqueda, estadoFiltro]);

  // Vigente por fecha NO es lo mismo que "puede entrar": el kiosko
  // (Asistencia.estadoAcceso) también exige cupo cuando el plan es por
  // CLASES. Estas filas figuran vigentes acá y rebotan en la puerta, así que
  // conviene avisarlo en vez de dejar que el número mienta.
  //
  // Sólo aplica a HOY: `SuscripcionClasesRestantes` es el saldo actual, no
  // hay histórico del cupo, así que esto no se puede reflejar en la serie.
  const sinCupoHoy = useMemo(
    () =>
      (data?.detalle || []).filter(
        (f) => f.modalidad === "CLASES" && f.clasesRestantes <= 0 && f.estado === "A"
      ).length,
    [data]
  );

  const handlePDF = async () => {
    if (!data || generandoPDF) return;
    try {
      setGenerandoPDF(true);
      let nombreGimnasio = "GIMNASIO";
      try {
        const cfg = await getConfiguracion("GIMNASIO_NOMBRE");
        if (cfg?.ConfigValor) nombreGimnasio = cfg.ConfigValor;
      } catch {
        /* usa el default */
      }
      await generarPDFSuscripcionesVigentes({
        reporte: data,
        filas: detalleFiltrado,
        planNombre:
          planes.find((p) => Number(p.PlanId) === Number(planId))?.PlanNombre ||
          null,
        nombreGimnasio,
      });
    } catch (e) {
      Swal.fire({
        icon: "error",
        title: "No se pudo generar el PDF",
        text: e instanceof Error ? e.message : "Error inesperado",
      });
    } finally {
      setGenerandoPDF(false);
    }
  };

  if (!puedeLeer) {
    return <PermissionDenied resource="el reporte de suscripciones vigentes" />;
  }

  const r = data?.resumen;
  const variacion = r ? r.vigentesAlFin - r.vigentesAlInicio : 0;
  const unidad = PASO_UNIDAD[data?.paso || "dia"] || PASO_UNIDAD.dia;
  const prev = data?.comparacion?.resumen;
  const inputCls =
    "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700";
  const labelCls =
    "text-xs font-semibold uppercase tracking-wider text-text-muted";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-strong">
          Suscripciones vigentes
        </h1>
        <p className="text-sm text-text-muted">
          Cuántas suscripciones estuvieron corriendo en un rango de fechas, con
          el inicio y el fin de cada una. No son las altas del período: incluye
          a los socios que arrancaron antes y siguen vigentes.
        </p>
      </div>

      {/* ---- Filtros ---- */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>
            Desde
            <input
              type="date"
              value={fechaDesde}
              max={fechaHasta || undefined}
              onChange={(e) => setFechaDesde(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Hasta
            <input
              type="date"
              value={fechaHasta}
              min={fechaDesde || undefined}
              onChange={(e) => setFechaHasta(e.target.value)}
              className={inputCls}
            />
          </label>
          {planes.length > 0 && (
            <label className={labelCls}>
              Plan
              <select
                value={planId ?? ""}
                onChange={(e) =>
                  setPlanId(e.target.value ? Number(e.target.value) : null)
                }
                className={inputCls}
              >
                <option value="">Todos los planes</option>
                {planes.map((p) => (
                  <option key={p.PlanId} value={p.PlanId}>
                    {p.PlanNombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label
            className="flex items-center gap-2 pb-2 text-sm text-text"
            title="SuscripcionEstado no guarda cuándo se canceló, así que una cancelada hoy también desaparece del pasado. Marcá esto para ver el otro extremo."
          >
            <input
              type="checkbox"
              checked={incluirCanceladas}
              onChange={(e) => setIncluirCanceladas(e.target.checked)}
              className="h-4 w-4 rounded border-border text-brand-700 focus:ring-brand-700"
            />
            Incluir canceladas y suspendidas
          </label>
          <div className="ml-auto flex items-end gap-2 pb-0.5">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={ArrowDownTrayIcon}
              loading={generandoPDF}
              disabled={!data || loading}
              onClick={handlePDF}
            >
              PDF
            </Button>
            <Button size="sm" loading={loading} onClick={cargar}>
              Actualizar
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {rangosRapidos.map((p) => {
            const activo = p.desde === fechaDesde && p.hasta === fechaHasta;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setFechaDesde(p.desde);
                  setFechaHasta(p.hasta);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activo
                    ? "bg-brand-600 text-white"
                    : "bg-surface-muted text-text-muted hover:text-text"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </Card>

      {loading && <LoadingState message="Calculando el reporte…" />}
      {!loading && error && <ErrorState message={error} onRetry={cargar} />}

      {!loading && !error && data && r && (
        <>
          {/* ---- KPIs ---- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Vigentes en el período"
              value={formatMiles(r.suscripciones)}
              icon={UserGroupIcon}
              tone="brand"
              trend={variacionVsPrevio(r.suscripciones, prev?.suscripciones)}
              hint={`${formatMiles(r.socios)} socio${
                r.socios === 1 ? "" : "s"
              } distinto${r.socios === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Del primer al último día"
              value={`${formatMiles(r.vigentesAlInicio)} → ${formatMiles(
                r.vigentesAlFin
              )}`}
              tone={
                variacion > 0 ? "success" : variacion < 0 ? "danger" : "neutral"
              }
              trend={{
                direction:
                  variacion > 0 ? "up" : variacion < 0 ? "down" : "flat",
                label:
                  variacion === 0
                    ? "sin cambio"
                    : `${variacion > 0 ? "+" : ""}${formatMiles(variacion)}`,
              }}
              hint={`Foto del ${formatDateLocal(
                data.fechaDesde
              )} y del ${formatDateLocal(data.fechaHasta)}`}
            />
            <StatCard
              label="Altas del período"
              value={formatMiles(r.altas)}
              icon={ArrowTrendingUpIcon}
              tone="success"
              trend={variacionVsPrevio(r.altas, prev?.altas)}
              hint="Arrancaron dentro del rango"
            />
            <StatCard
              label="Vencen en el período"
              value={formatMiles(r.bajas)}
              icon={ExclamationTriangleIcon}
              tone="warning"
              // Más vencimientos NO es una buena noticia: la flecha se
              // invierte para que subir pinte rojo y no verde.
              trend={variacionVsPrevio(r.bajas, prev?.bajas, false)}
              hint="Terminan dentro del rango: hay que renovarlas"
            />
          </div>

          {data.comparacion && (
            <p className="-mt-2 text-xs text-text-subtle">
              Las flechas comparan contra el período contiguo anterior, del
              mismo largo:{" "}
              <span className="font-num">
                {formatDateLocal(data.comparacion.desde)} –{" "}
                {formatDateLocal(data.comparacion.hasta)}
              </span>{" "}
              ({formatMiles(data.comparacion.resumen.suscripciones)} vigentes,{" "}
              {formatMiles(data.comparacion.resumen.socios)} socios).
            </p>
          )}

          {/* ---- Desglose por plan ---- */}
          {data.porPlan.length > 1 && (
            <Card padding="none">
              <div className="p-5">
                <CardHeader
                  title="Por plan"
                  description="Qué plan sostiene el plantel. Un socio con dos planes distintos cuenta en los dos, así que la suma de socios puede superar el total."
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-surface-sunken text-left text-xs uppercase tracking-wider text-text-muted">
                      <th className="px-4 py-2 font-semibold">Plan</th>
                      <th className="px-4 py-2 text-right font-semibold">
                        Suscripciones
                      </th>
                      <th className="px-4 py-2 text-right font-semibold">
                        Socios
                      </th>
                      <th className="px-4 py-2 font-semibold">Participación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porPlan.map((p) => {
                      const pct =
                        r.suscripciones > 0
                          ? (p.suscripciones / r.suscripciones) * 100
                          : 0;
                      return (
                        <tr
                          key={p.planId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-2">
                            {/* Click = filtrar por ese plan, que es lo que el
                                usuario iba a hacer a mano con el combo. */}
                            <button
                              type="button"
                              onClick={() =>
                                setPlanId(planId === p.planId ? null : p.planId)
                              }
                              className="text-brand-700 hover:underline"
                              title={
                                planId === p.planId
                                  ? "Quitar el filtro"
                                  : "Filtrar el reporte por este plan"
                              }
                            >
                              {p.plan}
                            </button>
                          </td>
                          <td className="px-4 py-2 text-right font-num text-text">
                            {formatMiles(p.suscripciones)}
                          </td>
                          <td className="px-4 py-2 text-right font-num text-text-muted">
                            {formatMiles(p.socios)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
                                aria-hidden="true"
                              >
                                <div
                                  className="h-full rounded-full bg-brand-600"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-12 text-right font-num text-xs text-text-muted">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ---- Evolución ---- */}
          <Card>
            <CardHeader
              title="Vigentes en cada fecha"
              description={`Cada punto es una foto de ese día (muestreo ${
                PASO_LABEL[data.paso] || "por día"
              }), no un acumulado: los valores no se suman entre sí. ${
                unidad.promedio
              }: ${formatMilesWithDecimals(r.promedioSerie)}${
                r.pico
                  ? ` · ${unidad.pico} ${formatMiles(
                      r.pico.suscripciones
                    )} el ${formatDateLocal(r.pico.fecha)}`
                  : ""
              }.`}
            />
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <AreaChart data={data.serie}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={(v: string) => etiquetaEje(v, data.paso)}
                    minTickGap={24}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(v) => formatDateLocal(String(v))}
                    formatter={(value) => formatMiles(Number(value ?? 0))}
                  />
                  <ReferenceLine
                    y={r.promedioSerie}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    label={{ value: "Promedio", position: "right", fontSize: 10 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="suscripciones"
                    name="Suscripciones vigentes"
                    stroke="#2563eb"
                    fill="#2563eb"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ---- Detalle ---- */}
          <Card padding="none">
            <div className="flex flex-wrap items-end justify-between gap-4 p-5">
              <CardHeader
                title={`Detalle — ${formatMiles(detalleFiltrado.length)} de ${formatMiles(
                  data.detalle.length
                )}`}
                description={
                  sinCupoHoy > 0
                    ? `Ordenado por fecha de fin. ${sinCupoHoy} con plan por clases y cupo agotado: figuran vigentes pero el kiosko les bloquea la entrada.`
                    : "Ordenado por fecha de fin: primero lo que vence antes."
                }
              />
              <div className="flex flex-wrap items-end gap-3">
                <label className={labelCls}>
                  Buscar
                  <input
                    type="text"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Socio, CI o plan"
                    className={inputCls}
                  />
                </label>
                <label className={labelCls}>
                  Estado hoy
                  <select
                    value={estadoFiltro}
                    onChange={(e) => setEstadoFiltro(e.target.value)}
                    className={inputCls}
                  >
                    <option value="TODOS">Todos</option>
                    <option value="A">Vigente hoy</option>
                    <option value="V">Ya vencida</option>
                    <option value="F">Futura</option>
                    {incluirCanceladas && (
                      <>
                        <option value="C">Cancelada</option>
                        <option value="S">Suspendida</option>
                      </>
                    )}
                  </select>
                </label>
              </div>
            </div>

            {data.detalleTruncado && (
              <div className="border-y border-warning-200 bg-warning-50 px-5 py-2 text-xs text-warning-700">
                El detalle está cortado en {formatMiles(data.limiteDetalle)}{" "}
                filas. Los totales de arriba sí cuentan todas: para ver el resto,
                acotá el rango o filtrá por plan.
              </div>
            )}

            {detalleFiltrado.length === 0 ? (
              <EmptyState
                title="Sin suscripciones en el rango"
                description="Ninguna suscripción estuvo vigente entre esas fechas con los filtros aplicados."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-surface-sunken text-left text-xs uppercase tracking-wider text-text-muted">
                      <th className="px-4 py-2 font-semibold">Socio</th>
                      <th className="px-4 py-2 font-semibold">CI / RUC</th>
                      <th className="px-4 py-2 font-semibold">Plan</th>
                      <th className="px-4 py-2 font-semibold">Inicio</th>
                      <th className="px-4 py-2 font-semibold">Fin</th>
                      <th className="px-4 py-2 font-semibold">
                        Cubre en el rango
                      </th>
                      <th className="px-4 py-2 text-right font-semibold">
                        Días
                      </th>
                      <th className="px-4 py-2 font-semibold">Estado hoy</th>
                      <th className="px-4 py-2 text-right font-semibold">
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleFiltrado.map((f) => {
                      const est = ESTADOS[f.estado] || {
                        label: f.estado,
                        tone: "neutral" as const,
                      };
                      // Marcamos las que no cubren el rango entero: ayuda a
                      // entender por qué el total del período es mayor que
                      // los vigentes de cualquier día suelto.
                      const parcial = f.diasEnRango < data.dias;
                      return (
                        <tr
                          key={f.suscripcionId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-2 font-medium">
                            {f.clienteId ? (
                              <Link
                                to={`/clientes/${f.clienteId}/ficha`}
                                className="text-brand-700 hover:underline"
                                title="Ver ficha del alumno"
                              >
                                {f.socio}
                              </Link>
                            ) : (
                              <span className="text-text">{f.socio}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-num text-text-muted">
                            {f.ruc || "—"}
                          </td>
                          <td className="px-4 py-2 text-text-muted">
                            {f.plan || "—"}
                            {f.modalidad === "CLASES" &&
                              (f.clasesRestantes > 0 ? (
                                <span className="ml-1 font-num text-xs text-info-700">
                                  ({f.clasesRestantes} clase
                                  {f.clasesRestantes === 1 ? "" : "s"})
                                </span>
                              ) : (
                                <span
                                  className="ml-1 text-xs font-semibold text-danger-700"
                                  title="El plan es por clases y el cupo está agotado: el kiosko le bloquea la entrada aunque la fecha de fin todavía no llegó."
                                >
                                  (sin cupo)
                                </span>
                              ))}
                          </td>
                          <td className="px-4 py-2 font-num text-text">
                            {formatDateLocal(f.fechaInicio)}
                          </td>
                          <td className="px-4 py-2 font-num text-text">
                            {formatDateLocal(f.fechaFin)}
                          </td>
                          {/* Tramo recortado al rango. Es la respuesta directa
                              a "¿hasta cuándo estuvo cubierto este socio en el
                              período que pedí?": una suscripción que arranca
                              antes y termina el 5 muestra 01/xx → 05/xx, sin
                              obligar a cruzar la fecha de fin con el rango. */}
                          <td className="px-4 py-2 font-num">
                            {parcial ? (
                              <span
                                className="text-text"
                                title={`La suscripción corre del ${formatDateLocal(
                                  f.fechaInicio
                                )} al ${formatDateLocal(
                                  f.fechaFin
                                )}; dentro del rango consultado cubre ${f.diasEnRango} de ${f.diasTotales} días.`}
                              >
                                {formatDateLocal(f.cubreDesde)}
                                <span className="mx-1 text-text-subtle">→</span>
                                {formatDateLocal(f.cubreHasta)}
                              </span>
                            ) : (
                              <span className="text-text-subtle">
                                todo el rango
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-num text-text">
                            {formatMiles(f.diasEnRango)}
                            {parcial && (
                              <span
                                className="ml-1 text-xs text-text-subtle"
                                title={`La suscripción dura ${f.diasTotales} días en total.`}
                              >
                                / {formatMiles(f.diasTotales)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <Badge tone={est.tone}>{est.label}</Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-num">
                            {f.saldoPendiente > 0 ? (
                              <span className="text-warning-700">
                                {formatMiles(f.saldoPendiente)}
                              </span>
                            ) : (
                              <span className="text-text-subtle">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
