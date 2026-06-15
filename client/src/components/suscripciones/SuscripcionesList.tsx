import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import SearchButton from "../common/Input/SearchButton";
import ActionButton from "../common/Button/ActionButton";
import DataTable from "../common/Table/DataTable";
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  NoSymbolIcon,
  PauseIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import ClienteModal from "../common/ClienteModal";
import Swal from "sweetalert2";
import { useAuth } from "../../contexts/useAuth";
import {
  addDaysLocal,
  formatDateLocal,
  todayLocalISO,
} from "../../utils/utils";
import {
  calcularEstadoPorFechas,
  getEstadoDisplay as utilGetEstadoDisplay,
  isEstadoManual as utilIsEstadoManual,
  estadoBadgeClass,
  type EstadoDisplay,
} from "../../utils/suscripcionEstado";
import {
  useClientesPlanes,
  type Plan,
} from "../../hooks/useClientesPlanes";

interface Suscripcion {
  id: string | number;
  SuscripcionId: string | number;
  ClienteId: string | number;
  PlanId: string | number;
  SuscripcionFechaInicio: string;
  SuscripcionFechaFin: string;
  SuscripcionEstado?: string;
  SuscripcionClasesRestantes?: number;
  ClienteNombre?: string;
  ClienteApellido?: string;
  PlanNombre?: string;
  PlanModalidad?: string;
  PlanCantidadClases?: number;
  EstadoPago?: string;
  [key: string]: unknown;
}

const isPlanActivo = (plan: Plan) =>
  plan.PlanActivo === 1 || plan.PlanActivo === true;

interface Pagination {
  totalItems: number;
}

interface SuscripcionesListProps {
  suscripciones: Suscripcion[];
  onDelete?: (item: Suscripcion) => void;
  onEdit?: (item: Suscripcion) => void;
  onCreate?: () => void;
  onRenovar?: (item: Suscripcion) => void;
  onCancelar?: (item: Suscripcion) => void;
  onSuspender?: (item: Suscripcion) => void;
  onReactivar?: (item: Suscripcion) => void;
  pagination?: Pagination;
  onSearch: (value: string) => void;
  searchTerm: string;
  onKeyPress?: React.KeyboardEventHandler<HTMLInputElement>;
  onSearchSubmit: () => void;
  isModalOpen: boolean;
  onCloseModal: () => void;
  currentSuscripcion?: Suscripcion | null;
  onSubmit: (formData: Suscripcion) => void | Promise<void>;
  sortKey?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (key: string, order: "asc" | "desc") => void;
  // Filtros controlados por la página (se aplican en el backend).
  filtroEstado: EstadoDisplay | "TODOS";
  filtroPago: "TODOS" | "PAGADA" | "PENDIENTE";
  onFiltroEstadoChange: (v: EstadoDisplay | "TODOS") => void;
  onFiltroPagoChange: (v: "TODOS" | "PAGADA" | "PENDIENTE") => void;
}

export default function SuscripcionesList({
  suscripciones,
  onDelete,
  onEdit,
  onCreate,
  onRenovar,
  onCancelar,
  onSuspender,
  onReactivar,
  pagination,
  onSearch,
  searchTerm,
  onKeyPress,
  onSearchSubmit,
  isModalOpen,
  onCloseModal,
  currentSuscripcion,
  onSubmit,
  sortKey,
  sortOrder,
  onSort,
  filtroEstado,
  filtroPago,
  onFiltroEstadoChange,
  onFiltroPagoChange,
}: SuscripcionesListProps) {

  const [formData, setFormData] = useState({
    id: "",
    SuscripcionId: "",
    ClienteId: "",
    PlanId: "",
    SuscripcionFechaInicio: "",
    SuscripcionFechaFin: "",
    SuscripcionClasesRestantes: "" as string | number,
  });
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const {
    clientes,
    planes,
    clienteSeleccionado,
    setClienteSeleccionado,
    clienteSeleccionadoRef,
    showClienteModal,
    setShowClienteModal,
    selectCliente,
    createAndSelectCliente,
  } = useClientesPlanes({
    currentUserId: user?.id,
    onClienteSelected: (cliente) =>
      setFormData((prev) => ({ ...prev, ClienteId: String(cliente.ClienteId) })),
  });

  useEffect(() => {
    if (currentSuscripcion) {
      const cliente = clientes.find(
        (c) => Number(c.ClienteId) === Number(currentSuscripcion.ClienteId)
      );
      setClienteSeleccionado(cliente || null);

      const fechaInicio = currentSuscripcion.SuscripcionFechaInicio
        ? currentSuscripcion.SuscripcionFechaInicio.split("T")[0]
        : "";
      const fechaFin = currentSuscripcion.SuscripcionFechaFin
        ? currentSuscripcion.SuscripcionFechaFin.split("T")[0]
        : "";

      setFormData({
        id: String(currentSuscripcion.id ?? currentSuscripcion.SuscripcionId),
        SuscripcionId: String(currentSuscripcion.SuscripcionId),
        ClienteId: String(currentSuscripcion.ClienteId),
        PlanId: String(currentSuscripcion.PlanId),
        SuscripcionFechaInicio: fechaInicio,
        SuscripcionFechaFin: fechaFin,
        SuscripcionClasesRestantes:
          currentSuscripcion.SuscripcionClasesRestantes ?? "",
      });
    } else if (currentSuscripcion === null && !clienteSeleccionadoRef.current) {
      // Solo resetear cuando currentSuscripcion cambia a null Y no hay cliente seleccionado.
      // Evita reset cuando se crea un cliente desde el modal anidado.
      const fechaHoy = todayLocalISO();
      setClienteSeleccionado(null);
      setFormData({
        id: "",
        SuscripcionId: "",
        ClienteId: "",
        PlanId: "",
        SuscripcionFechaInicio: fechaHoy,
        SuscripcionFechaFin: "",
        SuscripcionClasesRestantes: "",
      });
    }
    // El hook ya re-sincroniza el cliente seleccionado cuando cambia la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSuscripcion, clientes]);

  const calculateFechaFin = (fechaInicio: string, planId: string | number) => {
    if (!fechaInicio || !planId) return "";
    const plan = planes.find((p) => Number(p.PlanId) === Number(planId));
    if (!plan || !plan.PlanDuracion) return "";
    return addDaysLocal(fechaInicio, plan.PlanDuracion);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    setFormData((prev) => {
      const newData = {
        ...prev,
        [name]: value,
      };

      // Si cambió la fecha de inicio y hay un plan seleccionado, calcular fecha fin
      if (name === "SuscripcionFechaInicio" && prev.PlanId) {
        const fechaFin = calculateFechaFin(value, prev.PlanId);
        if (fechaFin) {
          newData.SuscripcionFechaFin = fechaFin;
        }
      }

      // Si cambió el plan y hay una fecha de inicio, recalcular fecha fin
      if (name === "PlanId" && prev.SuscripcionFechaInicio && value) {
        const fechaFin = calculateFechaFin(prev.SuscripcionFechaInicio, value);
        if (fechaFin) {
          newData.SuscripcionFechaFin = fechaFin;
        }
      }

      return newData;
    });
  };

  // selectCliente y createAndSelectCliente vienen del hook; quedan disponibles
  // como `selectCliente` / `createAndSelectCliente` y disparan onClienteSelected
  // (que actualiza formData.ClienteId).

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return; // evita doble submit (suscripciones duplicadas)
    if (!clienteSeleccionado || !formData.ClienteId) {
      Swal.fire({
        icon: "warning",
        title: "Cliente requerido",
        text: "Debe seleccionar un cliente",
      });
      return;
    }
    // El input guarda SuscripcionClasesRestantes como string|number; lo
    // normalizamos a number|undefined para que matchee el tipo Suscripcion
    // (y el backend, que usa COALESCE para no pisar el cupo con vacío).
    const payload = {
      ...formData,
      SuscripcionClasesRestantes:
        formData.SuscripcionClasesRestantes === "" ||
        formData.SuscripcionClasesRestantes == null
          ? undefined
          : Number(formData.SuscripcionClasesRestantes),
    };
    setSubmitting(true);
    try {
      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCloseModal();
    }
  };

  // Cerrar el modal con Escape (accesibilidad: ruta de escape por teclado).
  useEffect(() => {
    if (!isModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isModalOpen, onCloseModal]);

  // Atrapar el foco dentro del modal mientras está abierto.
  const dialogRef = useRef<HTMLFormElement>(null);
  useFocusTrap(isModalOpen, dialogRef);

  const formatDate = (dateString: string) => formatDateLocal(dateString);

  // La lógica vive en utils/suscripcionEstado.ts (compartida con FichaAlumnoPage).
  const getEstadoDisplay = (s: Suscripcion): EstadoDisplay =>
    utilGetEstadoDisplay(s);
  const isEstadoManual = (s: Suscripcion): boolean => utilIsEstadoManual(s);

  const columns = [
    { key: "SuscripcionId", label: "ID" },
    {
      key: "ClienteNombre",
      label: "Cliente",
      render: (suscripcion: Suscripcion) => {
        const nombre =
          `${suscripcion.ClienteNombre || ""} ${
            suscripcion.ClienteApellido || ""
          }`.trim() || "N/A";
        if (!suscripcion.ClienteId) return nombre;
        return (
          <Link
            to={`/clientes/${suscripcion.ClienteId}/ficha`}
            className="text-blue-600 hover:underline"
            title="Ver ficha del alumno"
          >
            {nombre}
          </Link>
        );
      },
    },
    {
      key: "PlanNombre",
      label: "Plan",
      render: (suscripcion: Suscripcion) => suscripcion.PlanNombre || "N/A",
    },
    {
      key: "SuscripcionFechaInicio",
      label: "Fecha Inicio",
      render: (suscripcion: Suscripcion) =>
        formatDate(suscripcion.SuscripcionFechaInicio),
    },
    {
      key: "SuscripcionFechaFin",
      label: "Fecha Fin",
      render: (suscripcion: Suscripcion) =>
        formatDate(suscripcion.SuscripcionFechaFin),
    },
    {
      key: "SuscripcionEstado",
      label: "Estado",
      render: (suscripcion: Suscripcion) => {
        const estado = getEstadoDisplay(suscripcion);
        return (
          <span
            className={`px-2 py-1 rounded text-xs font-semibold ${estadoBadgeClass(estado)}`}
          >
            {estado}
          </span>
        );
      },
    },
    {
      key: "EstadoPago",
      label: "Estado Pago",
      render: (suscripcion: Suscripcion) => {
        const estadoPago = suscripcion.EstadoPago || "PENDIENTE";
        return (
          <span
            className={`px-2 py-1 rounded text-xs font-semibold ${
              estadoPago === "PAGADA"
                ? "bg-green-100 text-green-800"
                : "bg-yellow-100 text-yellow-800"
            }`}
          >
            {estadoPago}
          </span>
        );
      },
    },
  ];

  // Los filtros de estado/pago se aplican en el BACKEND (controlados por la
  // página), así el total y la paginación reflejan el universo filtrado, no
  // solo la página visible.

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="flex-1">
          <SearchButton
            searchTerm={searchTerm}
            onSearch={onSearch}
            onKeyPress={onKeyPress}
            onSearchSubmit={onSearchSubmit}
            placeholder="Buscar por cliente, RUC, plan o ID"
          />
        </div>
        <div className="py-4">
          {onCreate && (
            <ActionButton
              label="Nueva Suscripción"
              onClick={onCreate}
              icon={PlusIcon}
            />
          )}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div className="text-sm text-gray-600">
          Mostrando {suscripciones.length} (total: {pagination?.totalItems})
        </div>
        <div className="flex gap-2">
          <div>
            <label
              htmlFor="filtro-estado"
              className="block text-xs text-gray-500 mb-1"
            >
              Estado
            </label>
            <select
              id="filtro-estado"
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md cursor-pointer"
              value={filtroEstado}
              onChange={(e) =>
                onFiltroEstadoChange(e.target.value as EstadoDisplay | "TODOS")
              }
            >
              <option value="TODOS">Todos</option>
              <option value="ACTIVA">Activa</option>
              <option value="VENCIDA">Vencida</option>
              <option value="FUTURA">Futura</option>
              <option value="CANCELADA">Cancelada</option>
              <option value="SUSPENDIDA">Suspendida</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="filtro-pago"
              className="block text-xs text-gray-500 mb-1"
            >
              Pago
            </label>
            <select
              id="filtro-pago"
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md cursor-pointer"
              value={filtroPago}
              onChange={(e) =>
                onFiltroPagoChange(
                  e.target.value as "TODOS" | "PAGADA" | "PENDIENTE"
                )
              }
            >
              <option value="TODOS">Todos</option>
              <option value="PAGADA">Pagadas</option>
              <option value="PENDIENTE">Pendientes</option>
            </select>
          </div>
        </div>
      </div>
      <DataTable<Suscripcion>
        columns={columns}
        data={suscripciones}
        onEdit={onEdit}
        onDelete={onDelete}
        emptyMessage="No se encontraron suscripciones"
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={onSort}
        customActions={(suscripcion) => {
          const estado = getEstadoDisplay(suscripcion);
          const manual = isEstadoManual(suscripcion);
          return (
            <>
              {onRenovar &&
                !manual &&
                estado !== "FUTURA" &&
                estado !== "CANCELADA" && (
                  <button
                    type="button"
                    onClick={() => onRenovar(suscripcion)}
                    title="Renovar suscripción"
                    aria-label="Renovar suscripción"
                    className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800 hover:bg-blue-50 mr-1 p-1.5 rounded cursor-pointer"
                  >
                    <ArrowPathIcon className="h-5 w-5" />
                  </button>
                )}
              {onSuspender && !manual && (
                <button
                  type="button"
                  onClick={() => onSuspender(suscripcion)}
                  title="Suspender suscripción"
                  aria-label="Suspender suscripción"
                  className="inline-flex items-center justify-center text-amber-600 hover:text-amber-800 hover:bg-amber-50 mr-1 p-1.5 rounded cursor-pointer"
                >
                  <PauseIcon className="h-5 w-5" />
                </button>
              )}
              {onCancelar && !manual && (
                <button
                  type="button"
                  onClick={() => onCancelar(suscripcion)}
                  title="Cancelar suscripción"
                  aria-label="Cancelar suscripción"
                  className="inline-flex items-center justify-center text-gray-600 hover:text-gray-800 hover:bg-gray-100 mr-1 p-1.5 rounded cursor-pointer"
                >
                  <NoSymbolIcon className="h-5 w-5" />
                </button>
              )}
              {onReactivar && manual && (
                <button
                  type="button"
                  onClick={() => onReactivar(suscripcion)}
                  title="Reactivar suscripción"
                  aria-label="Reactivar suscripción"
                  className="inline-flex items-center justify-center text-green-600 hover:text-green-800 hover:bg-green-50 mr-1 p-1.5 rounded cursor-pointer"
                >
                  <ArrowUturnLeftIcon className="h-5 w-5" />
                </button>
              )}
            </>
          );
        }}
      />
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={handleBackdropClick}
        >
          <div className="absolute inset-0 bg-black opacity-50" />
          <div className="relative w-full max-w-2xl max-h-full z-10">
            <form
              ref={dialogRef}
              tabIndex={-1}
              onSubmit={handleSubmit}
              role="dialog"
              aria-modal="true"
              aria-labelledby="suscripcion-modal-title"
              className="relative bg-white rounded-lg shadow max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between p-4 border-b rounded-t">
                <h3
                  id="suscripcion-modal-title"
                  className="text-xl font-semibold text-gray-900"
                >
                  {currentSuscripcion
                    ? `Editar suscripción: ${currentSuscripcion.SuscripcionId}`
                    : "Crear nueva suscripción"}
                </h3>
                <button
                  type="button"
                  aria-label="Cerrar"
                  className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ml-auto inline-flex justify-center items-center"
                  onClick={onCloseModal}
                >
                  <svg
                    className="w-3 h-3"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 14 14"
                  >
                    <path
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                    />
                  </svg>
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-6 gap-6">
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="ClienteId"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Cliente
                    </label>
                    <button
                      type="button"
                      id="ClienteId"
                      aria-haspopup="dialog"
                      onClick={() => setShowClienteModal(true)}
                      className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 text-left hover:bg-gray-100 transition"
                    >
                      {clienteSeleccionado
                        ? `${clienteSeleccionado.ClienteNombre} ${
                            clienteSeleccionado.ClienteApellido || ""
                          }`
                        : "Seleccionar cliente"}
                    </button>
                    {!clienteSeleccionado && (
                      <p className="mt-1 text-xs text-red-600">
                        * Debe seleccionar un cliente
                      </p>
                    )}
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="PlanId"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Plan
                    </label>
                    <select
                      name="PlanId"
                      id="PlanId"
                      value={formData.PlanId}
                      onChange={handleInputChange}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    >
                      <option value="">Seleccionar plan</option>
                      {planes
                        .filter(
                          (plan) =>
                            isPlanActivo(plan) ||
                            String(plan.PlanId) === String(formData.PlanId)
                        )
                        .map((plan) => (
                          <option key={plan.PlanId} value={plan.PlanId}>
                            {plan.PlanNombre}
                            {!isPlanActivo(plan) ? " (inactivo)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="SuscripcionFechaInicio"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Fecha Inicio
                    </label>
                    <input
                      type="date"
                      name="SuscripcionFechaInicio"
                      id="SuscripcionFechaInicio"
                      value={formData.SuscripcionFechaInicio}
                      onChange={handleInputChange}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="SuscripcionFechaFin"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Fecha Fin
                    </label>
                    <input
                      type="date"
                      name="SuscripcionFechaFin"
                      id="SuscripcionFechaFin"
                      value={formData.SuscripcionFechaFin}
                      onChange={handleInputChange}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="SuscripcionEstado"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Estado
                    </label>
                    <input
                      type="text"
                      name="SuscripcionEstado"
                      id="SuscripcionEstado"
                      value={
                        formData.SuscripcionFechaInicio &&
                        formData.SuscripcionFechaFin
                          ? calcularEstadoPorFechas(
                              formData.SuscripcionFechaInicio,
                              formData.SuscripcionFechaFin
                            )
                          : "ACTIVA"
                      }
                      readOnly
                      disabled
                      className="bg-gray-100 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2.5 cursor-not-allowed"
                      title="El estado se calcula automáticamente según las fechas"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      * El estado se calcula automáticamente según las fechas
                    </p>
                  </div>

                  {/* Cupo de clases — sólo visible cuando el plan elegido es
                      modalidad CLASES. Permite ajustar el cupo si el operador
                      cargó mal o necesita acreditarle clases extra al alumno.
                      Para MENSUAL/OPEN no aplica (no se usa cupo). */}
                  {(() => {
                    const planActual = planes.find(
                      (p) => String(p.PlanId) === String(formData.PlanId)
                    );
                    if (
                      !planActual ||
                      planActual.PlanModalidad !== "CLASES" ||
                      !currentSuscripcion
                    )
                      return null;
                    return (
                      <div className="col-span-6 sm:col-span-3">
                        <label
                          htmlFor="SuscripcionClasesRestantes"
                          className="block mb-2 text-sm font-medium text-gray-900"
                        >
                          Clases restantes
                        </label>
                        <input
                          type="number"
                          name="SuscripcionClasesRestantes"
                          id="SuscripcionClasesRestantes"
                          min={0}
                          max={
                            (planActual.PlanCantidadClases as number) ?? undefined
                          }
                          value={formData.SuscripcionClasesRestantes}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              SuscripcionClasesRestantes: e.target.value,
                            }))
                          }
                          className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Cupo original del plan: {planActual.PlanCantidadClases ?? 0}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="flex items-center p-6 space-x-2 border-t border-gray-200 rounded-b">
                <ActionButton
                  label={
                    submitting
                      ? "Guardando..."
                      : currentSuscripcion
                        ? "Actualizar"
                        : "Crear"
                  }
                  type="submit"
                  disabled={submitting}
                />
                <ActionButton
                  label="Cancelar"
                  className="text-gray-500 bg-white hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-blue-300 rounded-lg border border-gray-200 text-sm font-medium px-5 py-2.5 hover:text-gray-900 focus:z-10"
                  onClick={onCloseModal}
                />
              </div>
            </form>
          </div>
        </div>
      )}
      <ClienteModal
        show={showClienteModal}
        onClose={() => setShowClienteModal(false)}
        clientes={clientes}
        onSelect={selectCliente}
        onCreateCliente={createAndSelectCliente}
        currentUserId={user?.id}
        showFechaNacimiento={true}
      />
    </>
  );
}
