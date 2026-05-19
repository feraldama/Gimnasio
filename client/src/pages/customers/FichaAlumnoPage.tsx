import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import Swal from "sweetalert2";
import { getClienteById } from "../../services/clientes.service";
import { getSuscripcionesByCliente } from "../../services/suscripciones.service";
import { getPagosByCliente } from "../../services/pagos.service";
import { getAsistenciasPorCliente, type AsistenciaItem } from "../../services/asistencia.service";
import {
  Card,
  CardHeader,
  Badge,
  StatCard,
  LoadingState,
  PermissionDenied,
} from "../../components/common/ui";
import { usePermiso } from "../../hooks/usePermiso";
import { formatDateLocal, formatMiles, todayLocalISO } from "../../utils/utils";
import { getPagoTipoLabel } from "../../constants/pagoTipos";

interface Cliente {
  ClienteId: number;
  ClienteNombre: string;
  ClienteApellido?: string;
  ClienteTelefono?: string;
  ClienteRUC?: string;
  ClienteDV?: string;
  ClienteDireccion?: string;
  ClienteFechaNacimiento?: string;
}

interface Suscripcion {
  SuscripcionId: number;
  SuscripcionFechaInicio: string;
  SuscripcionFechaFin: string;
  SuscripcionEstado?: string;
  SuscripcionClasesRestantes?: number;
  PlanId?: number;
  PlanNombre?: string;
  PlanPrecio?: number;
  PlanModalidad?: string;
  PlanCantidadClases?: number;
  EstadoPago?: string;
  TotalPagado?: number;
}

interface Pago {
  PagoId: number;
  SuscripcionId: number;
  PagoMonto: number;
  PagoTipo: string;
  PagoFecha: string;
  PlanNombre?: string;
}

type TabKey = "datos" | "suscripciones" | "pagos" | "asistencias" | "deuda";

const calcularVigencia = (s: Suscripcion): string => {
  if (s.SuscripcionEstado === "C") return "CANCELADA";
  if (s.SuscripcionEstado === "S") return "SUSPENDIDA";
  if (!s.SuscripcionFechaInicio || !s.SuscripcionFechaFin) return "—";
  const hoy = todayLocalISO();
  const i = s.SuscripcionFechaInicio.split("T")[0];
  const f = s.SuscripcionFechaFin.split("T")[0];
  if (hoy < i) return "FUTURA";
  if (hoy > f) return "VENCIDA";
  return "ACTIVA";
};

const vigenciaTone: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  ACTIVA: "success",
  FUTURA: "info",
  VENCIDA: "danger",
  CANCELADA: "neutral",
  SUSPENDIDA: "warning",
};

function edad(fechaNac?: string): string {
  if (!fechaNac) return "—";
  const d = new Date(fechaNac);
  if (isNaN(d.getTime())) return "—";
  const ahora = new Date();
  let a = ahora.getFullYear() - d.getFullYear();
  const m = ahora.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ahora.getDate() < d.getDate())) a--;
  return a > 0 ? `${a} años` : "—";
}

export default function FichaAlumnoPage() {
  const { id } = useParams<{ id: string }>();
  const puedeLeer = usePermiso("FICHAALUMNO", "leer");

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [asistencias, setAsistencias] = useState<AsistenciaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("datos");

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [cR, sR, pR, aR] = await Promise.all([
        getClienteById(id),
        getSuscripcionesByCliente(id),
        getPagosByCliente(id),
        getAsistenciasPorCliente(id, 200),
      ]);
      setCliente(cR || null);
      setSuscripciones(sR.data || []);
      setPagos(pR.data || []);
      setAsistencias(aR || []);
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo cargar la ficha",
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (puedeLeer) fetchData();
  }, [puedeLeer, fetchData]);

  const totalCobrado = pagos.reduce((a, p) => a + Number(p.PagoMonto), 0);

  // Deuda: suma de PlanPrecio - TotalPagado por suscripción.
  const deudaPorSuscripcion = useMemo(() => {
    return suscripciones
      .map((s) => {
        const total = Number(s.PlanPrecio || 0);
        const pagado = Number(s.TotalPagado || 0);
        const saldo = total - pagado;
        return { s, total, pagado, saldo };
      })
      .filter((d) => d.saldo > 0);
  }, [suscripciones]);

  const totalDeuda = deudaPorSuscripcion.reduce((a, d) => a + d.saldo, 0);

  const suscripcionActiva = suscripciones.find(
    (s) => calcularVigencia(s) === "ACTIVA"
  );

  // Asistencias agregadas por mes para el gráfico.
  const asistenciaPorMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of asistencias) {
      const k = (a.AsistenciaFecha || "").slice(0, 7);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, cantidad]) => ({ mes, cantidad }));
  }, [asistencias]);

  if (!puedeLeer) return <PermissionDenied resource="la ficha del alumno" />;
  if (loading) return <LoadingState />;
  if (!cliente) return <div className="p-6">Cliente no encontrado</div>;

  const tabs: { key: TabKey; label: string }[] = [
    { key: "datos", label: "Datos" },
    { key: "suscripciones", label: "Suscripciones" },
    { key: "pagos", label: "Pagos" },
    { key: "asistencias", label: "Asistencias" },
    { key: "deuda", label: `Deuda${totalDeuda > 0 ? ` (Gs. ${formatMiles(totalDeuda)})` : ""}` },
  ];

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link to="/customers" className="text-sm text-blue-600 hover:underline">
          ← Volver a clientes
        </Link>
      </div>

      {/* Header tipo "carnet" */}
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">
              {cliente.ClienteNombre} {cliente.ClienteApellido || ""}
            </h1>
            <div className="text-sm text-gray-500 mt-1 space-x-3">
              {cliente.ClienteRUC && (
                <span>
                  RUC/CI: {cliente.ClienteRUC}
                  {cliente.ClienteDV ? `-${cliente.ClienteDV}` : ""}
                </span>
              )}
              {cliente.ClienteTelefono && <span>Tel: {cliente.ClienteTelefono}</span>}
              <span>Edad: {edad(cliente.ClienteFechaNacimiento)}</span>
            </div>
            {cliente.ClienteDireccion && (
              <div className="text-sm text-gray-500 mt-1">
                {cliente.ClienteDireccion}
              </div>
            )}
          </div>
          {suscripcionActiva && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 min-w-[220px]">
              <div className="text-xs text-green-800 uppercase font-medium">
                Plan vigente
              </div>
              <div className="text-base font-semibold text-green-900">
                {suscripcionActiva.PlanNombre || "—"}
              </div>
              <div className="text-xs text-green-800 mt-1">
                Hasta {formatDateLocal(suscripcionActiva.SuscripcionFechaFin)}
              </div>
              {suscripcionActiva.PlanModalidad === "CLASES" && (
                <div className="text-xs text-green-800 mt-1">
                  Clases restantes:{" "}
                  <strong>{suscripcionActiva.SuscripcionClasesRestantes ?? 0}</strong> /{" "}
                  {suscripcionActiva.PlanCantidadClases ?? 0}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Suscripciones" value={String(suscripciones.length)} />
        <StatCard label="Pagos registrados" value={String(pagos.length)} />
        <StatCard
          label="Total cobrado"
          value={`Gs. ${formatMiles(totalCobrado)}`}
          tone="brand"
        />
        <StatCard
          label="Deuda"
          value={totalDeuda > 0 ? `Gs. ${formatMiles(totalDeuda)}` : "Gs. 0"}
          tone={totalDeuda > 0 ? "danger" : "success"}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "datos" && (
        <Card>
          <CardHeader title="Datos del alumno" />
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6 text-sm">
            <div>
              <dt className="text-gray-500">Nombre completo</dt>
              <dd>{cliente.ClienteNombre} {cliente.ClienteApellido || ""}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Cédula</dt>
              <dd>{cliente.ClienteRUC || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">RUC completo</dt>
              <dd>
                {cliente.ClienteRUC
                  ? `${cliente.ClienteRUC}${cliente.ClienteDV ? `-${cliente.ClienteDV}` : ""}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Teléfono</dt>
              <dd>{cliente.ClienteTelefono || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Dirección</dt>
              <dd>{cliente.ClienteDireccion || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Fecha de nacimiento</dt>
              <dd>
                {cliente.ClienteFechaNacimiento
                  ? formatDateLocal(cliente.ClienteFechaNacimiento)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Edad</dt>
              <dd>{edad(cliente.ClienteFechaNacimiento)}</dd>
            </div>
          </dl>
        </Card>
      )}

      {tab === "suscripciones" && (
        <Card>
          <CardHeader title="Historial de suscripciones" />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Modalidad</th>
                  <th className="px-3 py-2 text-left">Desde</th>
                  <th className="px-3 py-2 text-left">Hasta</th>
                  <th className="px-3 py-2 text-center">Vigencia</th>
                  <th className="px-3 py-2 text-center">Pago</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {suscripciones.map((s) => {
                  const v = calcularVigencia(s);
                  return (
                    <tr key={s.SuscripcionId}>
                      <td className="px-3 py-2">{s.PlanNombre || "—"}</td>
                      <td className="px-3 py-2">
                        {s.PlanModalidad === "CLASES"
                          ? `Por clases (${s.SuscripcionClasesRestantes ?? 0}/${s.PlanCantidadClases ?? 0})`
                          : s.PlanModalidad === "OPEN"
                          ? "Pase libre"
                          : "Mensual"}
                      </td>
                      <td className="px-3 py-2">
                        {formatDateLocal(s.SuscripcionFechaInicio)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDateLocal(s.SuscripcionFechaFin)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge tone={vigenciaTone[v] || "neutral"}>{v}</Badge>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge
                          tone={s.EstadoPago === "PAGADA" ? "success" : "warning"}
                        >
                          {s.EstadoPago || "—"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        Gs. {formatMiles(s.PlanPrecio || 0)}
                      </td>
                    </tr>
                  );
                })}
                {suscripciones.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      Sin suscripciones registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "pagos" && (
        <Card>
          <CardHeader title="Pagos recibidos" />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pagos.map((p) => (
                  <tr key={p.PagoId}>
                    <td className="px-3 py-2">{formatDateLocal(p.PagoFecha)}</td>
                    <td className="px-3 py-2">{p.PlanNombre || "—"}</td>
                    <td className="px-3 py-2">{getPagoTipoLabel(p.PagoTipo)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      Gs. {formatMiles(p.PagoMonto)}
                    </td>
                  </tr>
                ))}
                {pagos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                      Sin pagos registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "asistencias" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Asistencias por mes" />
            {asistenciaPorMes.length === 0 ? (
              <div className="text-sm text-gray-500 py-4">
                Sin asistencias registradas.
              </div>
            ) : (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={asistenciaPorMes}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mes" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="cantidad" fill="#16a34a" name="Asistencias" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Últimas asistencias" />
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Hora entrada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {asistencias.slice(0, 30).map((a) => (
                    <tr key={a.AsistenciaId}>
                      <td className="px-3 py-2">
                        {formatDateLocal(a.AsistenciaFecha)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {a.AsistenciaHoraEntrada
                          ? new Date(a.AsistenciaHoraEntrada).toLocaleTimeString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {asistencias.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-6 text-center text-gray-500">
                        Sin asistencias.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "deuda" && (
        <Card>
          <CardHeader
            title="Suscripciones con saldo pendiente"
            description={
              totalDeuda > 0
                ? `Deuda total: Gs. ${formatMiles(totalDeuda)}`
                : "El alumno está al día."
            }
          />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Período</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Pagado</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {deudaPorSuscripcion.map(({ s, total, pagado, saldo }) => (
                  <tr key={s.SuscripcionId}>
                    <td className="px-3 py-2">{s.PlanNombre || "—"}</td>
                    <td className="px-3 py-2">
                      {formatDateLocal(s.SuscripcionFechaInicio)} —{" "}
                      {formatDateLocal(s.SuscripcionFechaFin)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      Gs. {formatMiles(total)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      Gs. {formatMiles(pagado)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-700">
                      Gs. {formatMiles(saldo)}
                    </td>
                  </tr>
                ))}
                {deudaPorSuscripcion.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      Sin saldo pendiente.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
