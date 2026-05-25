import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BanknotesIcon,
  PhoneIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { usePermiso } from "../../hooks/usePermiso";
import {
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
  TextInput,
  Badge,
} from "../../components/common/ui";
import {
  getClientesConDeuda,
  type ClienteConDeuda,
  type ClientesConDeudaResp,
} from "../../services/clientes.service";
import { formatMiles } from "../../utils/utils";

// Filtros locales: aplican sobre la lista cargada (sin round-trip al backend).
// El endpoint devuelve todos los clientes con saldo > 0 y, en una pyme, ese
// listado raramente supera los 100 — manejarlo en memoria es suficiente.
type FiltroTipo = "TODOS" | "CON_GIMNASIO" | "CON_VENTAS" | "CON_CANCHA";

const linkTel = (tel?: string): string | null => {
  if (!tel) return null;
  const digits = tel.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("595") ? `+${digits}` : `+595${digits.replace(/^0/, "")}`;
};

export default function ClientesConDeudaPage() {
  const puedeLeer = usePermiso("CLIENTESCONDEUDA", "leer");
  const [data, setData] = useState<ClientesConDeudaResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("TODOS");

  const fetchData = () => {
    setLoading(true);
    setError(null);
    getClientesConDeuda()
      .then((d) => setData(d))
      .catch((e) => setError(e?.message || "Error al cargar"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (puedeLeer) fetchData();
  }, [puedeLeer]);

  const filtrados = useMemo(() => {
    if (!data) return [];
    const term = filtroNombre.trim().toLowerCase();
    return data.data.filter((c) => {
      if (
        term &&
        !`${c.ClienteNombre} ${c.ClienteApellido}`.toLowerCase().includes(term) &&
        !(c.ClienteRUC || "").toLowerCase().includes(term)
      ) {
        return false;
      }
      if (filtroTipo === "CON_GIMNASIO" && c.saldoGimnasio <= 0) return false;
      if (filtroTipo === "CON_VENTAS" && c.saldoVentas <= 0) return false;
      if (filtroTipo === "CON_CANCHA" && c.saldoCancha <= 0) return false;
      return true;
    });
  }, [data, filtroNombre, filtroTipo]);

  if (!puedeLeer)
    return <PermissionDenied resource="la vista de clientes con deuda" />;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Card>
        <CardHeader
          title="Clientes con deuda"
          description="Vista consolidada: gimnasio + cantina (crédito) + cancha (crédito). Ordenados por saldo total descendente."
          actions={
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer disabled:opacity-50"
              title="Recargar"
            >
              <ArrowPathIcon className="w-4 h-4" />
              Recargar
            </button>
          }
        />

        {/* KPI cards con totales del período actual */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Clientes</div>
              <div className="text-xl font-semibold">
                {data.cantidadClientes}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Gimnasio</div>
              <div className="text-xl font-semibold tabular-nums">
                Gs. {formatMiles(data.totales.gimnasio)}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Cantina</div>
              <div className="text-xl font-semibold tabular-nums">
                Gs. {formatMiles(data.totales.ventas)}
              </div>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-3">
              <div className="text-xs text-red-700">Total</div>
              <div className="text-xl font-bold text-red-900 tabular-nums">
                Gs. {formatMiles(data.totales.total)}
              </div>
              <div className="text-xs text-red-700 mt-0.5">
                (cancha: Gs. {formatMiles(data.totales.cancha)})
              </div>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1">
            <TextInput
              placeholder="Buscar por nombre, apellido o RUC..."
              value={filtroNombre}
              onChange={(e) => setFiltroNombre(e.target.value)}
            />
          </div>
          <div>
            <select
              className="px-3 py-2 border border-gray-300 rounded-md cursor-pointer text-sm"
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)}
            >
              <option value="TODOS">Todos los tipos</option>
              <option value="CON_GIMNASIO">Sólo con deuda gimnasio</option>
              <option value="CON_VENTAS">Sólo con deuda cantina</option>
              <option value="CON_CANCHA">Sólo con deuda cancha</option>
            </select>
          </div>
        </div>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Contacto</th>
                  <th className="px-3 py-2 text-right">Gimnasio</th>
                  <th className="px-3 py-2 text-right">Cantina</th>
                  <th className="px-3 py-2 text-right">Cancha</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtrados.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-sm text-gray-500"
                    >
                      {data && data.data.length > 0
                        ? "No hay clientes que coincidan con los filtros."
                        : "🎉 Nadie tiene deuda pendiente."}
                    </td>
                  </tr>
                ) : (
                  filtrados.map((c) => (
                    <FilaCliente key={c.ClienteId} cliente={c} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FilaCliente({ cliente: c }: { cliente: ClienteConDeuda }) {
  const tel = linkTel(c.ClienteTelefono);
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <Link
          to={`/clientes/${c.ClienteId}/ficha`}
          className="text-blue-600 hover:underline font-medium"
        >
          {c.ClienteNombre} {c.ClienteApellido}
        </Link>
        {c.ClienteRUC && (
          <div className="text-xs text-gray-500 tabular-nums">
            {c.ClienteRUC}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-sm">
        {tel ? (
          <a
            href={`https://wa.me/${tel.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-green-700 hover:underline"
            title="Abrir WhatsApp"
          >
            <PhoneIcon className="w-3.5 h-3.5" />
            {c.ClienteTelefono}
          </a>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {c.saldoGimnasio > 0 ? (
          <div>
            <div className="font-medium">Gs. {formatMiles(c.saldoGimnasio)}</div>
            <div className="text-xs text-gray-500">{c.cantGimnasio} suscripción(es)</div>
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {c.saldoVentas > 0 ? (
          <div>
            <div className="font-medium">Gs. {formatMiles(c.saldoVentas)}</div>
            <div className="text-xs text-gray-500">{c.cantVentas} venta(s)</div>
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {c.saldoCancha > 0 ? (
          <div>
            <div className="font-medium">Gs. {formatMiles(c.saldoCancha)}</div>
            <div className="text-xs text-gray-500">{c.cantCancha} crédito(s)</div>
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Badge tone="danger">
          <span className="tabular-nums">Gs. {formatMiles(c.saldoTotal)}</span>
        </Badge>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <Link
          to={`/credito-pagos?clienteId=${c.ClienteId}`}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700"
          title="Ir a cobrar"
        >
          <BanknotesIcon className="w-3.5 h-3.5" />
          Cobrar
        </Link>
      </td>
    </tr>
  );
}
