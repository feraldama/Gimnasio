import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
  StatCard,
} from "../../components/common/ui";
import { usePermiso } from "../../hooks/usePermiso";
import {
  getReporteGimnasioOcupacion,
  getReporteCanchaDiario,
  getReporteCantinaDiario,
  getReporteCanchaDesglose,
  getReporteCanchaHeatmap,
  type ReporteGimnasioResponse,
  type ReporteCanchaResponse,
  type ReporteCantinaResponse,
  type ReporteCanchaDesgloseResponse,
  type ReporteHeatmapResponse,
} from "../../services/reportes.service";
import { formatMiles, formatMilesCompact } from "../../utils/utils";
import {
  getCanchasActivas,
  type Cancha,
} from "../../services/cancha.service";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

// Pinta tres reportes mensuales pedidos por el cliente (whiteboard):
//   - Gimnasio: ocupacion acumulada S1..S4 (linea)
//   - Cancha:   ingreso diario D1..D30   (barras + meta)
//   - Cantina:  rotacion diaria (barras)
export default function ReportesGraficosPage() {
  const puedeLeer = usePermiso("REPORTESGRAFICOS", "leer");
  const now = useMemo(() => new Date(), []);
  const [anio, setAnio] = useState<number>(now.getFullYear());
  const [mes, setMes] = useState<number>(now.getMonth() + 1);

  const [gimnasio, setGimnasio] = useState<ReporteGimnasioResponse | null>(null);
  const [cancha, setCancha] = useState<ReporteCanchaResponse | null>(null);
  const [cantina, setCantina] = useState<ReporteCantinaResponse | null>(null);
  const [canchaDesglose, setCanchaDesglose] =
    useState<ReporteCanchaDesgloseResponse | null>(null);
  const [heatmap, setHeatmap] = useState<ReporteHeatmapResponse | null>(null);
  const [canchaFiltro, setCanchaFiltro] = useState<number | null>(null);
  const [canchasOpts, setCanchasOpts] = useState<Cancha[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [g, ca, ct, cd, hm] = await Promise.all([
        getReporteGimnasioOcupacion(anio, mes),
        getReporteCanchaDiario(anio, mes),
        getReporteCantinaDiario(anio, mes),
        getReporteCanchaDesglose(anio, mes, canchaFiltro),
        getReporteCanchaHeatmap(anio, mes, canchaFiltro),
      ]);
      setGimnasio(g);
      setCancha(ca);
      setCantina(ct);
      setCanchaDesglose(cd);
      setHeatmap(hm);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: string }).message)
          : "Error al cargar reportes";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [anio, mes, canchaFiltro]);

  // Cargar lista de canchas una sola vez para el selector de filtro.
  useEffect(() => {
    if (!puedeLeer) return;
    (async () => {
      try {
        const r = await getCanchasActivas();
        setCanchasOpts(r.data);
      } catch {
        /* silenciar; el filtro queda vacio */
      }
    })();
  }, [puedeLeer]);

  useEffect(() => {
    if (puedeLeer) fetchAll();
  }, [puedeLeer, fetchAll]);

  if (!puedeLeer) return <PermissionDenied />;

  const yearOptions = Array.from(
    { length: 6 },
    (_, i) => now.getFullYear() - 3 + i
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reportes Gráficos</h1>
          <p className="text-sm text-gray-500">
            Ocupación del gimnasio, ingresos de cancha y rotación de cantina.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 sm:flex-none min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">Año</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 sm:flex-none min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">Mes</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
            >
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {!loading && !error && gimnasio && (
        <Card>
          <CardHeader
            title="Gimnasio — Ocupación mensual (S₁..S₄)"
            description={`Inscripciones acumuladas vs capacidad mensual (R = ${gimnasio.capacidad}).`}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <StatCard label="Inscriptos del mes" value={String(gimnasio.totalInscriptos)} />
            <StatCard label="Capacidad (R)" value={String(gimnasio.capacidad)} />
            <StatCard
              label="Ocupación final"
              value={`${gimnasio.ocupacionFinalPct.toFixed(1)}%`}
            />
          </div>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={gimnasio.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="semana" />
                <YAxis yAxisId="left" label={{ value: "Inscriptos", angle: -90, position: "insideLeft" }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  label={{ value: "Ocupación %", angle: 90, position: "insideRight" }}
                />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="inscriptos"
                  stroke="#94a3b8"
                  name="Inscriptos semana"
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="acumulado"
                  stroke="#2563eb"
                  strokeWidth={2}
                  name="Acumulado (Sₙ × R)"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="ocupacionPct"
                  stroke="#16a34a"
                  strokeWidth={2}
                  name="Ocupación %"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {!loading && !error && cancha && (
        <Card>
          <CardHeader
            title="Cancha — Ingreso diario (D₁..D₃₀)"
            description={`Ingresos reales por día vs meta diaria ($T = ${formatMiles(cancha.meta)}).`}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <StatCard
              label="Ingreso total del mes"
              value={`Gs. ${formatMiles(cancha.totalIngreso)}`}
            />
            <StatCard label="Días con ingreso" value={String(cancha.diasConIngreso)} />
            <StatCard
              label="Promedio diario"
              value={`Gs. ${formatMiles(cancha.promedioDiario)}`}
            />
          </div>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={cancha.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dia" />
                <YAxis tickFormatter={(v) => formatMilesCompact(v as number)} />
                <Tooltip
                  formatter={(v) => `Gs. ${formatMiles(Number(v) || 0)}`}
                />
                <Legend />
                <ReferenceLine
                  y={cancha.meta}
                  stroke="#dc2626"
                  strokeDasharray="4 4"
                  label={{ value: "Meta", position: "right", fill: "#dc2626" }}
                />
                <Bar dataKey="ingreso" fill="#2563eb" name="Ingreso del día" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {!loading && !error && canchaDesglose && (
        <Card>
          <CardHeader
            title="Cancha — Desglose mensual"
            description={`Reservas activas del mes agrupadas por cancha y por banda de tarifa. Horario operativo: ${String(
              canchaDesglose.horario.inicio
            ).padStart(2, "0")}:00 — ${String(
              canchaDesglose.horario.fin
            ).padStart(2, "0")}:00 (${
              canchaDesglose.horario.horasPorDia
            } h/día).`}
            actions={
              canchasOpts.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 whitespace-nowrap">
                    Filtrar por cancha:
                  </label>
                  <select
                    className="bg-white border border-gray-300 text-sm rounded-md px-3 py-1.5 cursor-pointer"
                    value={canchaFiltro ?? ""}
                    onChange={(e) =>
                      setCanchaFiltro(
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                  >
                    <option value="">Todas</option>
                    {canchasOpts.map((c) => (
                      <option key={c.CanchaId} value={c.CanchaId}>
                        {c.CanchaNombre}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <StatCard
              label="Reservas del mes"
              value={String(canchaDesglose.totales.reservas)}
            />
            <StatCard
              label="Ingreso total"
              value={`Gs. ${formatMiles(canchaDesglose.totales.ingreso)}`}
              tone="brand"
            />
            <StatCard
              label="Horas ocupadas"
              value={`${canchaDesglose.totales.horasOcupadas.toFixed(1)} h`}
              hint={`de ${canchaDesglose.totales.horasDisponibles} h disp.`}
            />
            <StatCard
              label="Ocupación global"
              value={`${canchaDesglose.totales.ocupacionPct.toFixed(1)}%`}
              tone={
                canchaDesglose.totales.ocupacionPct >= 50 ? "success" : "warning"
              }
            />
          </div>

          {/* Por cancha — bar chart con ingreso + ocupación */}
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Por cancha
          </h3>
          {canchaDesglose.porCancha.length === 0 ? (
            <div className="text-sm text-gray-500 py-2 mb-4">
              Sin reservas pagadas en este mes.
            </div>
          ) : (
            <div style={{ width: "100%", height: 260 }} className="mb-4">
              <ResponsiveContainer>
                <ComposedChart data={canchaDesglose.porCancha}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="canchaNombre" />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) => formatMilesCompact(v as number)}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(v, name) =>
                      String(name).includes("%")
                        ? `${Number(v).toFixed(1)}%`
                        : `Gs. ${formatMiles(Number(v) || 0)}`
                    }
                  />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="ingreso"
                    fill="#2563eb"
                    name="Ingreso"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="ocupacionPct"
                    stroke="#16a34a"
                    strokeWidth={2}
                    name="Ocupación %"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabla compacta por cancha */}
          {canchaDesglose.porCancha.length > 0 && (
            <div className="overflow-x-auto mb-6">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Cancha</th>
                    <th className="px-3 py-2 text-right">Reservas</th>
                    <th className="px-3 py-2 text-right">Horas ocupadas</th>
                    <th className="px-3 py-2 text-right">Ocupación</th>
                    <th className="px-3 py-2 text-right">Ingreso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {canchaDesglose.porCancha.map((c) => (
                    <tr key={c.canchaId}>
                      <td className="px-3 py-2 font-medium">{c.canchaNombre}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.reservas}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.horasOcupadas.toFixed(1)} h
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.ocupacionPct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        Gs. {formatMiles(c.ingreso)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Por banda — pie chart */}
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Por banda de tarifa
          </h3>
          {canchaDesglose.porBanda.length === 0 ? (
            <div className="text-sm text-gray-500 py-2">
              Sin desglose por banda (no hay reservas o no hay tarifas
              definidas).
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={canchaDesglose.porBanda}
                      dataKey="ingreso"
                      nameKey="nombre"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(entry) => {
                        const e = entry as { name?: string };
                        return e.name || "";
                      }}
                    >
                      {canchaDesglose.porBanda.map((_, i) => (
                        <Cell
                          key={`cell-${i}`}
                          fill={
                            [
                              "#2563eb",
                              "#16a34a",
                              "#f59e0b",
                              "#dc2626",
                              "#7c3aed",
                              "#0891b2",
                            ][i % 6]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => `Gs. ${formatMiles(Number(v) || 0)}`}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Banda</th>
                      <th className="px-3 py-2 text-right">Reservas</th>
                      <th className="px-3 py-2 text-right">Ingreso</th>
                      <th className="px-3 py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {canchaDesglose.porBanda.map((b) => {
                      const pct =
                        canchaDesglose.totales.ingreso > 0
                          ? (b.ingreso / canchaDesglose.totales.ingreso) * 100
                          : 0;
                      return (
                        <tr key={b.bandaId ?? "sin"}>
                          <td className="px-3 py-2 font-medium">{b.nombre}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {b.reservas}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            Gs. {formatMiles(b.ingreso)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {pct.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {!loading && !error && heatmap && (
        <Card>
          <CardHeader
            title="Cancha — Horas pico"
            description="Reservas activas agrupadas por día de semana y hora del día. El color indica densidad."
          />
          {heatmap.totales.reservas === 0 ? (
            <div className="text-sm text-gray-500 py-3">
              Sin reservas para calcular el heatmap.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Heatmap grid */}
              <div className="lg:col-span-2 overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-gray-500 font-normal w-12"></th>
                      {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(
                        (d) => (
                          <th
                            key={d}
                            className="px-2 py-1 text-gray-700 font-semibold text-center w-14"
                          >
                            {d}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmap.horas.map((h) => (
                      <tr key={`hm-${h}`}>
                        <td className="px-2 py-0.5 text-gray-500 text-right tabular-nums">
                          {String(h).padStart(2, "0")}:00
                        </td>
                        {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                          const cell = heatmap.matriz.find(
                            (c) => c.dia === d && c.hora === h
                          );
                          const n = cell?.reservas || 0;
                          // Intensidad relativa al máximo del heatmap.
                          const max = Math.max(
                            ...heatmap.matriz.map((c) => c.reservas),
                            1
                          );
                          const pct = n / max;
                          // Color en escala azul: opacity por intensidad.
                          const bg =
                            n === 0
                              ? "bg-gray-50"
                              : pct < 0.25
                              ? "bg-blue-100"
                              : pct < 0.5
                              ? "bg-blue-200"
                              : pct < 0.75
                              ? "bg-blue-400 text-white"
                              : "bg-blue-600 text-white";
                          return (
                            <td
                              key={`cell-${d}-${h}`}
                              className={`px-1 py-0.5 text-center tabular-nums border border-white ${bg}`}
                              title={`${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][d]} ${String(
                                h
                              ).padStart(2, "0")}:00 — ${n} reserva${n === 1 ? "" : "s"}`}
                            >
                              {n > 0 ? n : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Ranking horas pico + por día */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Top 5 horas pico
                  </h3>
                  {heatmap.top.length === 0 ? (
                    <div className="text-xs text-gray-500">
                      No hay datos suficientes.
                    </div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                          <th className="px-2 py-1 text-left">#</th>
                          <th className="px-2 py-1 text-left">Día</th>
                          <th className="px-2 py-1 text-left">Hora</th>
                          <th className="px-2 py-1 text-right">Reservas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {heatmap.top.map((t, i) => (
                          <tr key={`top-${i}`}>
                            <td className="px-2 py-1 tabular-nums">{i + 1}</td>
                            <td className="px-2 py-1">
                              {
                                ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][
                                  t.dia
                                ]
                              }
                            </td>
                            <td className="px-2 py-1 tabular-nums">
                              {String(t.hora).padStart(2, "0")}:00
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums font-semibold">
                              {t.reservas}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Por día de la semana
                  </h3>
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-2 py-1 text-left">Día</th>
                        <th className="px-2 py-1 text-right">Reservas</th>
                        <th className="px-2 py-1 text-right">Ingreso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {heatmap.porDia
                        .slice()
                        .sort((a, b) => b.reservas - a.reservas)
                        .map((d) => (
                          <tr key={`pd-${d.dia}`}>
                            <td className="px-2 py-1">
                              {
                                [
                                  "Lunes",
                                  "Martes",
                                  "Miércoles",
                                  "Jueves",
                                  "Viernes",
                                  "Sábado",
                                  "Domingo",
                                ][d.dia]
                              }
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {d.reservas}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              Gs. {formatMiles(d.ingreso)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {!loading && !error && cantina && (
        <Card>
          <CardHeader
            title="Cantina — Rotación diaria"
            description={`Dₙ = recaudado / (efectivo + stock). Stock valuado actualmente en Gs. ${formatMiles(cantina.valorStockActual)}.`}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <StatCard
              label="Recaudado del mes"
              value={`Gs. ${formatMiles(cantina.totalRecaudado)}`}
            />
            <StatCard
              label="Valor stock actual"
              value={`Gs. ${formatMiles(cantina.valorStockActual)}`}
            />
            <StatCard
              label="Días con ventas"
              value={String(cantina.data.filter((d) => d.recaudado > 0).length)}
            />
          </div>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <ComposedChart data={cantina.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dia" />
                <YAxis
                  yAxisId="left"
                  tickFormatter={(v) => formatMilesCompact(v as number)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(v, name) =>
                    String(name).includes("%")
                      ? `${Number(v) || 0}%`
                      : `Gs. ${formatMiles(Number(v) || 0)}`
                  }
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="recaudado"
                  fill="#0ea5e9"
                  name="Recaudado del día"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="rotacionPct"
                  stroke="#dc2626"
                  name="Rotación %"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
