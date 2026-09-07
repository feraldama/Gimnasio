import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  BanknotesIcon,
  ArrowDownTrayIcon,
  ScaleIcon,
  ClockIcon,
  UserPlusIcon,
  ArrowPathIcon,
  UserMinusIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
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
  getTableroMensual,
  getCrecimiento,
  type TableroMensualResponse,
  type BloqueComparativo,
  type CrecimientoResponse,
} from "../../services/tablero.service";
import { formatMiles, formatMilesCompact } from "../../utils/utils";

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

// Los porcentajes del backend son `number | null`. null = no se puede
// calcular (mes anterior en cero, meta sin cargar, sin ingresos) y hay que
// mostrar "—", nunca 0: un 0% leería como fracaso donde no hay dato.
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

/** Variación con flecha y color. `invertirColor` para egresos: subir es malo. */
function Variacion({
  valor,
  invertirColor = false,
}: {
  valor: number | null;
  invertirColor?: boolean;
}) {
  if (valor === null) {
    return (
      <span className="text-text-subtle" title="El mes anterior fue cero">
        —
      </span>
    );
  }
  const sube = valor > 0;
  const plano = valor === 0;
  const bueno = invertirColor ? !sube : sube;
  const color = plano
    ? "text-text-muted"
    : bueno
      ? "text-success-700"
      : "text-danger-700";
  const Icono = sube ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
  return (
    <span className={`inline-flex items-center gap-1 font-num ${color}`}>
      {!plano && <Icono className="h-4 w-4" aria-hidden="true" />}
      {valor > 0 ? "+" : ""}
      {valor}%
    </span>
  );
}

/** Barra de cumplimiento de meta. Sin meta cargada no dibuja nada. */
function BarraMeta({ bloque }: { bloque: BloqueComparativo }) {
  if (bloque.cumplimientoPct === null) {
    return (
      <p className="text-xs text-text-subtle">
        Sin meta cargada — definila en Configuración
      </p>
    );
  }
  const p = bloque.cumplimientoPct;
  const ancho = Math.min(p, 100);
  const color =
    p >= 100 ? "bg-success-600" : p >= 75 ? "bg-warning-500" : "bg-danger-600";
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-text-muted">
          Meta Gs. {formatMiles(bloque.meta ?? 0)}
        </span>
        <span className="font-num font-semibold text-text">{p}%</span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Cumplimiento de meta"
      >
        <div className={`h-full ${color}`} style={{ width: `${ancho}%` }} />
      </div>
    </div>
  );
}

/**
 * Tablero mensual de administración: ingresos por línea de negocio, egresos
 * por categoría y resultado, cada cifra contra su meta y contra el mes
 * anterior.
 *
 * Base CAJA (lo cobrado). Es importante que se lea en pantalla: los reportes
 * gráficos de cancha informan facturado, así que los números no tienen por
 * qué coincidir y conviene que quede explícito.
 */
export default function TableroMensualPage() {
  const puedeLeer = usePermiso("TABLEROMENSUAL", "leer");
  const now = useMemo(() => new Date(), []);
  const [anio, setAnio] = useState<number>(now.getFullYear());
  const [mes, setMes] = useState<number>(now.getMonth() + 1);
  const [data, setData] = useState<TableroMensualResponse | null>(null);
  const [crec, setCrec] = useState<CrecimientoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!puedeLeer) return;
    setLoading(true);
    setError(null);
    try {
      const [tablero, crecimiento] = await Promise.all([
        getTableroMensual(anio, mes),
        getCrecimiento(anio, mes),
      ]);
      setData(tablero);
      setCrec(crecimiento);
    } catch (e) {
      const err = e as { message?: string; error?: string };
      setError(err.error || err.message || "Error al cargar el tablero");
    } finally {
      setLoading(false);
    }
  }, [anio, mes, puedeLeer]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!puedeLeer) return <PermissionDenied resource="el tablero mensual" />;

  const anios = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);
  const mesAnteriorLabel = data
    ? `${MESES[data.mesAnteriorRef.mes - 1]} ${data.mesAnteriorRef.anio}`
    : "";

  const enPerdida = (data?.resultado.monto ?? 0) < 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-strong">
            Tablero mensual
          </h1>
          <p className="text-sm text-text-muted">
            Ingresos cobrados, egresos, resultado y movimiento de socios.
            Comparado con {mesAnteriorLabel || "el mes anterior"}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Mes
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="mt-1 block rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
            >
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Año
            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="mt-1 block rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
            >
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && <LoadingState message="Cargando tablero…" />}
      {!loading && error && <ErrorState message={error} onRetry={cargar} />}

      {!loading && !error && data && (
        <>
          {/* Fila de cifras del mes */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Ingresos cobrados"
              value={`Gs. ${formatMiles(data.ingresos.monto)}`}
              icon={BanknotesIcon}
              tone="brand"
              hint={
                <span>
                  Meta {pct(data.ingresos.cumplimientoPct)} · vs mes anterior{" "}
                  <Variacion valor={data.ingresos.variacionPct} />
                </span>
              }
            />
            <StatCard
              label="Egresos"
              value={`Gs. ${formatMiles(data.egresos.monto)}`}
              icon={ArrowDownTrayIcon}
              tone="warning"
              hint={
                <span>
                  vs mes anterior{" "}
                  <Variacion valor={data.egresos.variacionPct} invertirColor />
                </span>
              }
            />
            <StatCard
              label="Resultado"
              value={`Gs. ${formatMiles(data.resultado.monto)}`}
              icon={ScaleIcon}
              tone={enPerdida ? "danger" : "success"}
              hint={
                <span>
                  Margen {pct(data.resultado.margenPct)} · vs mes anterior{" "}
                  <Variacion valor={data.resultado.variacionPct} />
                </span>
              }
            />
            <StatCard
              label="Pendiente de cobro"
              value={`Gs. ${formatMiles(data.porCobrar.total)}`}
              icon={ClockIcon}
              tone="info"
              hint="Saldo acumulado a hoy, no del mes"
            />
          </div>

          {/* Ingresos por línea de negocio */}
          <Card padding="none">
            <div className="p-5 pb-0">
              <CardHeader
                title="Ingresos por línea de negocio"
                description="Base caja: lo efectivamente cobrado en el mes. Los reportes gráficos de cancha informan lo facturado, por eso pueden no coincidir."
              />
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
              {data.lineas.map((l) => (
                <div
                  key={l.clave}
                  className="rounded-lg border border-border bg-surface-alt p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold text-text">
                      {l.nombre}
                    </h3>
                    <Variacion valor={l.variacionPct} />
                  </div>
                  <p className="mt-1 font-num text-2xl font-bold text-text-strong">
                    Gs. {formatMiles(l.monto)}
                  </p>
                  <p className="font-num text-xs text-text-muted">
                    {MESES[data.mesAnteriorRef.mes - 1]}: Gs.{" "}
                    {formatMiles(l.mesAnterior)}
                  </p>
                  <div className="mt-3">
                    <BarraMeta bloque={l} />
                  </div>
                  {l.porCobrar > 0 && (
                    <p className="mt-3 border-t border-border pt-2 font-num text-xs text-warning-700">
                      Gs. {formatMiles(l.porCobrar)} pendiente de cobro
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Egresos por categoría */}
          <Card padding="none">
            <div className="p-5 pb-0">
              <CardHeader
                title="Egresos por categoría"
                description="Movimientos de salida del registro diario de caja. La apertura y el cierre de caja no cuentan: son movimiento del cajón, no gasto."
              />
            </div>
            {data.egresos.porCategoria.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-text-muted">
                No hay egresos registrados en {MESES[data.mes - 1]}.
              </p>
            ) : (
              <div className="space-y-5 p-5">
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.egresos.porCategoria}
                      layout="vertical"
                      margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e2e8f0"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => formatMilesCompact(v as number)}
                        tick={{ fontSize: 12, fill: "#475569" }}
                      />
                      <YAxis
                        type="category"
                        dataKey="categoria"
                        width={130}
                        tick={{ fontSize: 12, fill: "#475569" }}
                      />
                      <Tooltip
                        formatter={(v) => `Gs. ${formatMiles(v as number)}`}
                        labelStyle={{ fontWeight: 600 }}
                      />
                      <Bar dataKey="monto" name="Egreso" radius={[0, 4, 4, 0]}>
                        {data.egresos.porCategoria.map((c) => (
                          <Cell key={c.categoria} fill="#b45309" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted">
                        <th className="py-2 pr-4 font-semibold">Categoría</th>
                        <th className="py-2 pr-4 text-right font-semibold">
                          {MESES[data.mes - 1]}
                        </th>
                        <th className="py-2 pr-4 text-right font-semibold">
                          {MESES[data.mesAnteriorRef.mes - 1]}
                        </th>
                        <th className="py-2 text-right font-semibold">
                          Variación
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.egresos.porCategoria.map((c, i) => (
                        <tr
                          key={c.categoria}
                          className={
                            i % 2 === 1 ? "bg-surface-sunken" : undefined
                          }
                        >
                          <td className="py-2 pr-4 text-text">{c.categoria}</td>
                          <td className="py-2 pr-4 text-right font-num text-text">
                            {formatMiles(c.monto)}
                          </td>
                          <td className="py-2 pr-4 text-right font-num text-text-muted">
                            {formatMiles(c.mesAnterior)}
                          </td>
                          <td className="py-2 text-right">
                            <Variacion valor={c.variacionPct} invertirColor />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border-strong font-semibold">
                        <td className="py-2 pr-4 text-text-strong">TOTAL</td>
                        <td className="py-2 pr-4 text-right font-num text-text-strong">
                          {formatMiles(data.egresos.monto)}
                        </td>
                        <td className="py-2 pr-4 text-right font-num text-text-muted">
                          {formatMiles(data.egresos.mesAnterior)}
                        </td>
                        <td className="py-2 text-right">
                          <Variacion
                            valor={data.egresos.variacionPct}
                            invertirColor
                          />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </Card>

          {/* Crecimiento de socios */}
          {crec && (
            <Card padding="none">
              <div className="p-5 pb-0">
                <CardHeader
                  title="Crecimiento de socios"
                  description={
                    <>
                      Altas y bajas cuentan personas; renovaciones y
                      retención, suscripciones. El crecimiento sale de la
                      variación de socios activos, no de altas menos bajas:
                      quien se va y vuelve más tarde no cierra contra ninguna
                      de las dos. Volver dentro de {crec.diasGracia} días del
                      vencimiento cuenta como renovación.
                    </>
                  }
                />
              </div>
              {crec.provisorio && (
                <p className="mx-5 mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700">
                  Mes provisorio: hay socios vencidos que todavía están dentro
                  de la ventana de gracia. Si renuevan, pasarán de baja a
                  renovación y estas cifras cambiarán.
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Altas (socios nuevos)"
                  value={crec.altas.cantidad}
                  icon={UserPlusIcon}
                  tone="success"
                  hint={
                    <span>
                      vs mes anterior <Variacion valor={crec.altas.variacionPct} />
                    </span>
                  }
                />
                <StatCard
                  label="Renovaciones"
                  value={crec.renovaciones.cantidad}
                  icon={ArrowPathIcon}
                  tone="brand"
                  hint={
                    <span>
                      vs mes anterior{" "}
                      <Variacion valor={crec.renovaciones.variacionPct} />
                    </span>
                  }
                />
                <StatCard
                  label="Bajas"
                  value={crec.bajas.cantidad}
                  icon={UserMinusIcon}
                  tone="danger"
                  hint={
                    <span>
                      vs mes anterior{" "}
                      <Variacion valor={crec.bajas.variacionPct} invertirColor />
                    </span>
                  }
                />
                <StatCard
                  label="Socios activos"
                  value={crec.variacionActivos.activosFinDeMes}
                  icon={UsersIcon}
                  tone={
                    crec.variacionActivos.cantidad < 0 ? "danger" : "success"
                  }
                  hint={
                    <span>
                      {crec.variacionActivos.cantidad > 0 ? "+" : ""}
                      {crec.variacionActivos.cantidad} vs{" "}
                      {crec.variacionActivos.activosFinMesAnterior} del mes
                      anterior
                    </span>
                  }
                />
              </div>
              <div className="border-t border-border px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-text-muted">
                      Retención del mes
                    </p>
                    <p className="text-xs text-text-subtle">
                      De {crec.retencion.vencidas} suscripciones vencidas,{" "}
                      {crec.retencion.retenidas} renovaron
                      {crec.retencion.canceladas > 0 &&
                        ` · ${crec.retencion.canceladas} canceladas a mano`}
                    </p>
                  </div>
                  <p className="font-num text-2xl font-bold text-text-strong">
                    {pct(crec.retencion.tasaPct)}
                  </p>
                </div>
                {crec.retencion.tasaPct !== null && (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className={
                        crec.retencion.tasaPct >= 80
                          ? "h-full bg-success-600"
                          : crec.retencion.tasaPct >= 60
                            ? "h-full bg-warning-500"
                            : "h-full bg-danger-600"
                      }
                      style={{
                        width: `${Math.min(crec.retencion.tasaPct, 100)}%`,
                      }}
                    />
                  </div>
                )}
                {crec.retencion.tasaPctMesAnterior !== null && (
                  <p className="mt-2 text-xs text-text-muted">
                    Mes anterior: {crec.retencion.tasaPctMesAnterior}%
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Cierre: resultado del mes */}
          <Card>
            <CardHeader
              title="Resultado del mes"
              description="Ingresos cobrados menos egresos, sobre la misma base caja."
            />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-text-muted">
                  Ingresos
                </p>
                <p className="font-num text-xl font-semibold text-text">
                  Gs. {formatMiles(data.ingresos.monto)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-text-muted">
                  Egresos
                </p>
                <p className="font-num text-xl font-semibold text-warning-700">
                  − Gs. {formatMiles(data.egresos.monto)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-text-muted">
                  Resultado {enPerdida && "(pérdida)"}
                </p>
                <p
                  className={`font-num text-xl font-bold ${
                    enPerdida ? "text-danger-700" : "text-success-700"
                  }`}
                >
                  Gs. {formatMiles(data.resultado.monto)}
                </p>
              </div>
            </div>
            <p className="mt-4 border-t border-border pt-3 text-xs text-text-subtle">
              Pendiente de cobro a hoy — Gimnasio: Gs.{" "}
              {formatMiles(data.porCobrar.gimnasio)} · Cantina: Gs.{" "}
              {formatMiles(data.porCobrar.cantina)} · Cancha: Gs.{" "}
              {formatMiles(data.porCobrar.cancha)}. Es un saldo acumulado, no
              del mes: un resultado flojo puede ser un mes de mucho crédito
              otorgado más que de poca actividad.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
