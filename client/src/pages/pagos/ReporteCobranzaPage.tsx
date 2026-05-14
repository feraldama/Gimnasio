import { useEffect, useState, useCallback } from "react";
import Swal from "sweetalert2";
import { getReporteCobranza } from "../../services/pagos.service";
import {
  addDaysLocal,
  formatDateLocal,
  formatMiles,
  todayLocalISO,
} from "../../utils/utils";
import { usePermiso } from "../../hooks/usePermiso";

type AgruparPor = "dia" | "semana" | "mes";

interface Fila {
  periodo: string;
  cantidad: number;
  contado: number;
  pos: number;
  transferencia: number;
  total: number;
}

interface Totales {
  cantidad: number;
  contado: number;
  pos: number;
  transferencia: number;
  total: number;
}

interface ReporteResponse {
  data: { filas: Fila[]; totales: Totales };
  agruparPor: AgruparPor;
  fechaDesde: string;
  fechaHasta: string;
}

const formatPeriodo = (periodo: string, agruparPor: AgruparPor): string => {
  if (agruparPor === "dia") return formatDateLocal(periodo);
  if (agruparPor === "mes") {
    // "2026-05" → "Mayo 2026"
    const [y, m] = periodo.split("-");
    const meses = [
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
    return `${meses[Number(m) - 1] || m} ${y}`;
  }
  // semana: "2026-W19"
  return periodo.replace("-W", " · Semana ");
};

export default function ReporteCobranzaPage() {
  const puedeLeer = usePermiso("PAGOS", "leer");

  const hoy = todayLocalISO();
  const haceUnMes = addDaysLocal(hoy, -30);

  const [fechaDesde, setFechaDesde] = useState(haceUnMes);
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [agruparPor, setAgruparPor] = useState<AgruparPor>("dia");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReporteResponse | null>(null);

  const fetchReporte = useCallback(async () => {
    if (!fechaDesde || !fechaHasta) return;
    if (fechaDesde > fechaHasta) {
      Swal.fire({
        icon: "warning",
        title: "Rango inválido",
        text: "La fecha desde no puede ser posterior a la fecha hasta.",
      });
      return;
    }
    try {
      setLoading(true);
      const response = await getReporteCobranza(
        fechaDesde,
        fechaHasta,
        agruparPor
      );
      setData(response);
    } catch (err) {
      const e = err as { message?: string };
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message || "No se pudo obtener el reporte",
      });
    } finally {
      setLoading(false);
    }
  }, [fechaDesde, fechaHasta, agruparPor]);

  useEffect(() => {
    if (puedeLeer) fetchReporte();
  }, [puedeLeer, fetchReporte]);

  if (!puedeLeer)
    return <div className="p-4">No tienes permiso para ver este reporte</div>;

  const filas = data?.data.filas || [];
  const totales = data?.data.totales;

  return (
    <div className="container mx-auto px-4">
      <h1 className="text-2xl font-medium mb-4">Reporte de Cobranza</h1>

      <div className="bg-white p-4 rounded-lg shadow mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Desde
          </label>
          <input
            type="date"
            value={fechaDesde}
            max={fechaHasta || undefined}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Hasta
          </label>
          <input
            type="date"
            value={fechaHasta}
            min={fechaDesde || undefined}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Agrupar por
          </label>
          <select
            value={agruparPor}
            onChange={(e) => setAgruparPor(e.target.value as AgruparPor)}
            className="bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 w-full"
          >
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </select>
        </div>
        <button
          type="button"
          onClick={fetchReporte}
          disabled={loading}
          className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg px-5 py-2.5 disabled:opacity-50"
        >
          {loading ? "Cargando..." : "Actualizar"}
        </button>
      </div>

      {totales && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <div className="bg-white rounded-lg shadow p-3">
            <div className="text-xs text-gray-500">Cobros</div>
            <div className="text-xl font-semibold">
              {formatMiles(totales.cantidad)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-3">
            <div className="text-xs text-gray-500">Contado</div>
            <div className="text-xl font-semibold">
              Gs. {formatMiles(totales.contado)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-3">
            <div className="text-xs text-gray-500">POS</div>
            <div className="text-xl font-semibold">
              Gs. {formatMiles(totales.pos)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-3">
            <div className="text-xs text-gray-500">Transferencia</div>
            <div className="text-xl font-semibold">
              Gs. {formatMiles(totales.transferencia)}
            </div>
          </div>
          <div className="bg-blue-50 rounded-lg shadow p-3 border border-blue-200">
            <div className="text-xs text-blue-700">Total</div>
            <div className="text-xl font-bold text-blue-900">
              Gs. {formatMiles(totales.total)}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Período
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Cobros
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Contado
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                POS
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Transferencia
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filas.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-gray-500"
                >
                  {loading
                    ? "Cargando..."
                    : "No hay cobros en el rango seleccionado"}
                </td>
              </tr>
            ) : (
              filas.map((f) => (
                <tr key={f.periodo} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm">
                    {formatPeriodo(f.periodo, agruparPor)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right">
                    {formatMiles(f.cantidad)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right">
                    Gs. {formatMiles(f.contado)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right">
                    Gs. {formatMiles(f.pos)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right">
                    Gs. {formatMiles(f.transferencia)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right font-semibold">
                    Gs. {formatMiles(f.total)}
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
