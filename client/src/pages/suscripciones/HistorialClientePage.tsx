import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Swal from "sweetalert2";
import { getClienteById } from "../../services/clientes.service";
import { getSuscripcionesByCliente } from "../../services/suscripciones.service";
import { getPagosByCliente } from "../../services/pagos.service";
import { formatDateLocal, formatMiles, todayLocalISO } from "../../utils/utils";
import { getPagoTipoLabel } from "../../constants/pagoTipos";
import { usePermiso } from "../../hooks/usePermiso";

interface Cliente {
  ClienteId: number;
  ClienteNombre: string;
  ClienteApellido?: string;
  ClienteTelefono?: string;
  ClienteRUC?: string;
}

interface Suscripcion {
  SuscripcionId: number;
  SuscripcionFechaInicio: string;
  SuscripcionFechaFin: string;
  SuscripcionEstado?: string;
  PlanNombre?: string;
  PlanPrecio?: number;
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
  UsuarioNombre?: string;
  UsuarioApellido?: string;
}

const calcularVigencia = (
  inicio?: string,
  fin?: string,
  estado?: string
): string => {
  if (estado === "C") return "CANCELADA";
  if (estado === "S") return "SUSPENDIDA";
  if (!inicio || !fin) return "—";
  const hoy = todayLocalISO();
  const i = inicio.split("T")[0];
  const f = fin.split("T")[0];
  if (hoy < i) return "FUTURA";
  if (hoy > f) return "VENCIDA";
  return "ACTIVA";
};

const vigenciaColor: Record<string, string> = {
  ACTIVA: "bg-green-100 text-green-800",
  VENCIDA: "bg-red-100 text-red-800",
  FUTURA: "bg-blue-100 text-blue-800",
  CANCELADA: "bg-gray-200 text-gray-700",
  SUSPENDIDA: "bg-amber-100 text-amber-800",
};

export default function HistorialClientePage() {
  const { id } = useParams<{ id: string }>();
  const puedeLeer = usePermiso("SUSCRIPCIONES", "leer");

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [clienteResp, suscResp, pagoResp] = await Promise.all([
        getClienteById(id),
        getSuscripcionesByCliente(id),
        getPagosByCliente(id),
      ]);
      setCliente(clienteResp || null);
      setSuscripciones(suscResp.data || []);
      setPagos(pagoResp.data || []);
    } catch (err) {
      const e = err as { message?: string };
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message || "No se pudo cargar el historial",
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (puedeLeer) fetchData();
  }, [puedeLeer, fetchData]);

  if (!puedeLeer)
    return <div className="p-4">No tienes permiso para ver este historial</div>;
  if (loading) return <div className="p-4">Cargando historial...</div>;
  if (!cliente)
    return <div className="p-4">Cliente no encontrado</div>;

  const totalCobrado = pagos.reduce((acc, p) => acc + Number(p.PagoMonto), 0);
  const suscripcionesPagadas = suscripciones.filter(
    (s) => s.EstadoPago === "PAGADA"
  ).length;

  return (
    <div className="container mx-auto px-4">
      <div className="mb-4">
        <Link to="/suscripciones" className="text-sm text-blue-600 hover:underline">
          ← Volver a suscripciones
        </Link>
      </div>

      <div className="bg-white p-4 rounded-lg shadow mb-4">
        <h1 className="text-2xl font-medium">
          {cliente.ClienteNombre} {cliente.ClienteApellido || ""}
        </h1>
        <div className="text-sm text-gray-500 mt-1">
          {cliente.ClienteRUC && <span>RUC/CI: {cliente.ClienteRUC} · </span>}
          {cliente.ClienteTelefono && <span>Tel: {cliente.ClienteTelefono}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Suscripciones</div>
          <div className="text-xl font-semibold">{suscripciones.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Pagadas</div>
          <div className="text-xl font-semibold">{suscripcionesPagadas}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Pagos registrados</div>
          <div className="text-xl font-semibold">{pagos.length}</div>
        </div>
        <div className="bg-blue-50 rounded-lg shadow p-3 border border-blue-200">
          <div className="text-xs text-blue-700">Total cobrado</div>
          <div className="text-xl font-bold text-blue-900">
            Gs. {formatMiles(totalCobrado)}
          </div>
        </div>
      </div>

      <h2 className="text-lg font-medium mb-2">Suscripciones</h2>
      <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Desde</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Hasta</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vigencia</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Precio</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Pagado</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {suscripciones.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                  Sin suscripciones registradas
                </td>
              </tr>
            ) : (
              suscripciones.map((s) => {
                const vigencia = calcularVigencia(
                  s.SuscripcionFechaInicio,
                  s.SuscripcionFechaFin,
                  s.SuscripcionEstado
                );
                return (
                  <tr key={s.SuscripcionId} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm">{s.SuscripcionId}</td>
                    <td className="px-4 py-2 text-sm">{s.PlanNombre || "—"}</td>
                    <td className="px-4 py-2 text-sm">{formatDateLocal(s.SuscripcionFechaInicio)}</td>
                    <td className="px-4 py-2 text-sm">{formatDateLocal(s.SuscripcionFechaFin)}</td>
                    <td className="px-4 py-2 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${vigenciaColor[vigencia] || ""}`}
                      >
                        {vigencia}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-right">
                      Gs. {formatMiles(s.PlanPrecio || 0)}
                    </td>
                    <td className="px-4 py-2 text-sm text-right">
                      Gs. {formatMiles(s.TotalPagado || 0)}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          s.EstadoPago === "PAGADA"
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {s.EstadoPago || "PENDIENTE"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-medium mb-2">Pagos</h2>
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Cobrado por</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {pagos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                  Sin pagos registrados
                </td>
              </tr>
            ) : (
              pagos.map((p) => (
                <tr key={p.PagoId} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm">{p.PagoId}</td>
                  <td className="px-4 py-2 text-sm">{formatDateLocal(p.PagoFecha)}</td>
                  <td className="px-4 py-2 text-sm">{p.PlanNombre || "—"}</td>
                  <td className="px-4 py-2 text-sm text-right font-semibold">
                    Gs. {formatMiles(p.PagoMonto)}
                  </td>
                  <td className="px-4 py-2 text-sm">{getPagoTipoLabel(p.PagoTipo)}</td>
                  <td className="px-4 py-2 text-sm">
                    {`${p.UsuarioNombre || ""} ${p.UsuarioApellido || ""}`.trim() || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
