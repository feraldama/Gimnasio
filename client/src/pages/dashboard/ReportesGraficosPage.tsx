import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
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
  type ReporteGimnasioResponse,
  type ReporteCanchaResponse,
  type ReporteCantinaResponse,
} from "../../services/reportes.service";
import { formatMiles } from "../../utils/utils";

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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [g, ca, ct] = await Promise.all([
        getReporteGimnasioOcupacion(anio, mes),
        getReporteCanchaDiario(anio, mes),
        getReporteCantinaDiario(anio, mes),
      ]);
      setGimnasio(g);
      setCancha(ca);
      setCantina(ct);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: string }).message)
          : "Error al cargar reportes";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [anio, mes]);

  useEffect(() => {
    if (puedeLeer) fetchAll();
  }, [puedeLeer, fetchAll]);

  if (!puedeLeer) return <PermissionDenied />;

  const yearOptions = Array.from(
    { length: 6 },
    (_, i) => now.getFullYear() - 3 + i
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reportes Gráficos</h1>
          <p className="text-sm text-gray-500">
            Ocupación del gimnasio, ingresos de cancha y rotación de cantina.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Año</label>
            <select
              className="px-3 py-2 border border-gray-300 rounded-md"
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
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mes</label>
            <select
              className="px-3 py-2 border border-gray-300 rounded-md"
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
                <YAxis tickFormatter={(v) => formatMiles(v as number)} />
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
                  tickFormatter={(v) => formatMiles(v as number)}
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
