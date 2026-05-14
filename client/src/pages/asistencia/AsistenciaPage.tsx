import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import {
  CheckCircleIcon,
  XCircleIcon,
  UserIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import ClienteModal from "../../components/common/ClienteModal";
import { useAuth } from "../../contexts/useAuth";
import { usePermiso } from "../../hooks/usePermiso";
import {
  useClientesPlanes,
  type Cliente,
} from "../../hooks/useClientesPlanes";
import {
  getEstadoAcceso,
  registrarAsistencia,
  listarAsistenciasDelDia,
  type EstadoAcceso,
} from "../../services/asistencia.service";
import { formatDateLocal, todayLocalISO } from "../../utils/utils";

interface AsistenciaItem {
  AsistenciaId: number;
  ClienteId: number;
  AsistenciaFecha: string;
  AsistenciaHoraEntrada: string;
  ClienteNombre?: string;
  ClienteApellido?: string;
  ClienteTelefono?: string;
}

const formatHora = (dt: string): string => {
  if (!dt) return "—";
  // dt viene como "YYYY-MM-DD HH:mm:ss" o ISO con Z. Tomamos solo la parte de hora.
  const m = dt.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "—";
  return `${m[1]}:${m[2]}`;
};

export default function AsistenciaPage() {
  const { user } = useAuth();
  const puedeLeer = usePermiso("SUSCRIPCIONES", "leer");

  // Reutilizamos el hook para tener la lista completa de clientes en el modal
  const { clientes, selectCliente, showClienteModal, setShowClienteModal } =
    useClientesPlanes({ currentUserId: user?.id });

  const [estado, setEstado] = useState<EstadoAcceso | null>(null);
  const [cargandoEstado, setCargandoEstado] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [asistencias, setAsistencias] = useState<AsistenciaItem[]>([]);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [fecha, setFecha] = useState(todayLocalISO());

  const cargarLista = useCallback(
    async (f: string) => {
      try {
        setCargandoLista(true);
        const resp = await listarAsistenciasDelDia(f);
        setAsistencias(resp.data || []);
      } catch (err) {
        const e = err as { message?: string };
        Swal.fire({
          icon: "error",
          title: "Error",
          text: e?.message || "No se pudo cargar la lista",
        });
      } finally {
        setCargandoLista(false);
      }
    },
    []
  );

  useEffect(() => {
    if (puedeLeer) cargarLista(fecha);
  }, [puedeLeer, fecha, cargarLista]);

  // Al elegir cliente desde el modal, consultamos su estado de acceso.
  // La firma debe ser síncrona porque ClienteModal.onSelect espera () => void.
  const handleSeleccionarCliente = (cliente: Cliente) => {
    selectCliente(cliente);
    setCargandoEstado(true);
    setEstado(null);
    getEstadoAcceso(cliente.ClienteId)
      .then(setEstado)
      .catch((err) => {
        const e = err as { message?: string };
        Swal.fire({
          icon: "error",
          title: "Error",
          text: e?.message || "No se pudo consultar el estado",
        });
      })
      .finally(() => setCargandoEstado(false));
  };

  const handleRegistrar = async () => {
    if (!estado?.cliente?.ClienteId) return;
    try {
      setRegistrando(true);
      const resp = await registrarAsistencia(estado.cliente.ClienteId);
      Swal.fire({
        position: "top-end",
        icon: "success",
        title: resp.message || "Asistencia registrada",
        showConfirmButton: false,
        timer: 1800,
      });
      setEstado(null);
      cargarLista(fecha);
    } catch (err) {
      const e = err as { message?: string };
      Swal.fire({
        icon: "error",
        title: "No se pudo registrar",
        text: e?.message || "Error inesperado",
      });
    } finally {
      setRegistrando(false);
    }
  };

  if (!puedeLeer)
    return <div className="p-4">No tienes permiso para ver esta sección</div>;

  return (
    <div className="container mx-auto px-4">
      <h1 className="text-2xl font-medium mb-4">Control de asistencia</h1>

      {/* Selector de cliente + semáforo */}
      <div className="bg-white p-4 rounded-lg shadow mb-4">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => setShowClienteModal(true)}
            className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg px-5 py-2.5 inline-flex items-center gap-2"
          >
            <UserIcon className="w-5 h-5" />
            Buscar cliente
          </button>
          <span className="text-sm text-text-muted">
            Buscar un socio para registrar su entrada
          </span>
        </div>

        {cargandoEstado && (
          <div className="p-4 bg-gray-50 rounded text-sm">Consultando estado...</div>
        )}

        {!cargandoEstado && estado && (
          <div
            className={`p-4 rounded-lg border ${
              estado.permitido
                ? "bg-green-50 border-green-300"
                : "bg-red-50 border-red-300"
            }`}
          >
            <div className="flex items-start gap-3">
              {estado.permitido ? (
                <CheckCircleIcon className="w-10 h-10 text-green-600 shrink-0" />
              ) : (
                <XCircleIcon className="w-10 h-10 text-red-600 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div
                  className={`text-lg font-semibold ${
                    estado.permitido ? "text-green-800" : "text-red-800"
                  }`}
                >
                  {estado.motivo}
                </div>
                {estado.cliente && (
                  <div className="text-sm mt-1">
                    <Link
                      to={`/clientes/${estado.cliente.ClienteId}/historial-gimnasio`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {estado.cliente.ClienteNombre}{" "}
                      {estado.cliente.ClienteApellido || ""}
                    </Link>
                    {estado.cliente.ClienteTelefono && (
                      <span className="text-gray-500 ml-2">
                        · {estado.cliente.ClienteTelefono}
                      </span>
                    )}
                  </div>
                )}
                {estado.suscripcion && (
                  <div className="text-sm text-gray-700 mt-1">
                    Plan: <strong>{estado.suscripcion.PlanNombre}</strong> ·
                    Vence: {formatDateLocal(estado.suscripcion.SuscripcionFechaFin)}
                    {estado.suscripcion.PlanPermiteClases ? (
                      <span className="ml-2 text-green-700">
                        · Acceso a clases ✓
                      </span>
                    ) : (
                      <span className="ml-2 text-amber-700">
                        · Sin acceso a clases
                      </span>
                    )}
                  </div>
                )}
                {estado.asistenciaHoy && (
                  <div className="text-sm text-amber-700 mt-2 inline-flex items-center gap-1">
                    <ClockIcon className="w-4 h-4" />
                    Ya registró entrada hoy a las{" "}
                    {formatHora(estado.asistenciaHoy.AsistenciaHoraEntrada)}
                  </div>
                )}

                {estado.permitido && (
                  <button
                    type="button"
                    onClick={handleRegistrar}
                    disabled={registrando}
                    className="mt-3 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg px-5 py-2.5 disabled:opacity-50"
                  >
                    {registrando ? "Registrando..." : "Registrar entrada"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lista de asistencias del día */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-medium">Asistencias</h2>
          <input
            type="date"
            value={fecha}
            max={todayLocalISO()}
            onChange={(e) => setFecha(e.target.value)}
            className="bg-gray-50 border border-gray-300 text-sm rounded-lg p-2"
          />
        </div>
        <div className="overflow-x-auto border-t border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Hora</th>
                <th className="px-4 py-2 text-left">Cliente</th>
                <th className="px-4 py-2 text-left">Teléfono</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cargandoLista ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                    Cargando...
                  </td>
                </tr>
              ) : asistencias.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                    Sin asistencias en esta fecha
                  </td>
                </tr>
              ) : (
                asistencias.map((a) => (
                  <tr key={a.AsistenciaId} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono">
                      {formatHora(a.AsistenciaHoraEntrada)}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to={`/clientes/${a.ClienteId}/historial-gimnasio`}
                        className="text-blue-600 hover:underline"
                      >
                        {`${a.ClienteNombre || ""} ${a.ClienteApellido || ""}`.trim() || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {a.ClienteTelefono || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-200">
          {asistencias.length} {asistencias.length === 1 ? "asistencia" : "asistencias"}
        </div>
      </div>

      <ClienteModal
        show={showClienteModal}
        onClose={() => setShowClienteModal(false)}
        clientes={clientes}
        onSelect={handleSeleccionarCliente}
        currentUserId={user?.id}
        hideTipo={true}
        showFechaNacimiento={true}
      />
    </div>
  );
}
