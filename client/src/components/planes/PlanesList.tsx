import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import SearchButton from "../common/Input/SearchButton";
import ActionButton from "../common/Button/ActionButton";
import DataTable from "../common/Table/DataTable";
import { PlusIcon } from "@heroicons/react/24/outline";
import { formatMiles } from "../../utils/utils";

interface Plan {
  id: string | number;
  PlanId: string | number;
  PlanNombre: string;
  PlanDuracion: number;
  PlanPrecio: number;
  PlanPermiteClases: boolean | number;
  PlanActivo: boolean | number;
  PlanModalidad?: string;
  PlanCantidadClases?: number;
  [key: string]: unknown;
}

const MODALIDAD_LABELS: Record<string, string> = {
  MENSUAL: "Mensual",
  CLASES: "Por clases (cupo)",
  OPEN: "Pase libre",
};

interface Pagination {
  totalItems: number;
}

interface PlanesListProps {
  planes: Plan[];
  onDelete?: (item: Plan) => void;
  onEdit?: (item: Plan) => void;
  onCreate?: () => void;
  pagination?: Pagination;
  onSearch: (value: string) => void;
  searchTerm: string;
  onKeyPress?: React.KeyboardEventHandler<HTMLInputElement>;
  onSearchSubmit: () => void;
  isModalOpen: boolean;
  onCloseModal: () => void;
  currentPlan?: Plan | null;
  onSubmit: (formData: Plan) => void | Promise<void>;
  sortKey?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (key: string, order: "asc" | "desc") => void;
}

export default function PlanesList({
  planes,
  onDelete,
  onEdit,
  onCreate,
  pagination,
  onSearch,
  searchTerm,
  onKeyPress,
  onSearchSubmit,
  isModalOpen,
  onCloseModal,
  currentPlan,
  onSubmit,
  sortKey,
  sortOrder,
  onSort,
}: PlanesListProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    id: "",
    PlanId: "",
    PlanNombre: "",
    PlanDuracion: 0,
    PlanPrecio: 0,
    PlanPermiteClases: false,
    PlanActivo: true,
    PlanModalidad: "MENSUAL",
    PlanCantidadClases: 0,
  });

  useEffect(() => {
    if (currentPlan) {
      setFormData({
        id: String(currentPlan.id ?? currentPlan.PlanId),
        PlanId: String(currentPlan.PlanId),
        PlanNombre: currentPlan.PlanNombre,
        PlanDuracion: currentPlan.PlanDuracion,
        PlanPrecio: currentPlan.PlanPrecio,
        PlanPermiteClases:
          currentPlan.PlanPermiteClases === 1 ||
          currentPlan.PlanPermiteClases === true,
        PlanActivo:
          currentPlan.PlanActivo === 1 || currentPlan.PlanActivo === true,
        PlanModalidad: currentPlan.PlanModalidad || "MENSUAL",
        PlanCantidadClases: currentPlan.PlanCantidadClases ?? 0,
      });
    } else {
      setFormData({
        id: "",
        PlanId: "",
        PlanNombre: "",
        PlanDuracion: 0,
        PlanPrecio: 0,
        PlanPermiteClases: false,
        PlanActivo: true,
        PlanModalidad: "MENSUAL",
        PlanCantidadClases: 0,
      });
    }
  }, [currentPlan]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : name === "PlanDuracion" || name === "PlanPrecio"
          ? Number(value)
          : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return; // evita doble submit
    setSubmitting(true);
    try {
      await onSubmit(formData);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCloseModal();
    }
  };

  // Cerrar el modal con Escape (ruta de escape por teclado).
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

  const columns = [
    { key: "PlanId", label: "ID" },
    { key: "PlanNombre", label: "Nombre" },
    {
      key: "PlanDuracion",
      label: "Duración (días)",
      render: (plan: Plan) => `${plan.PlanDuracion}`,
    },
    {
      key: "PlanPrecio",
      label: "Precio",
      render: (plan: Plan) => `Gs. ${formatMiles(plan.PlanPrecio)}`,
    },
    {
      key: "PlanPermiteClases",
      label: "Permite Clases",
      render: (plan: Plan) =>
        plan.PlanPermiteClases === 1 || plan.PlanPermiteClases === true
          ? "Sí"
          : "No",
    },
    {
      key: "PlanModalidad",
      label: "Modalidad",
      render: (plan: Plan) =>
        MODALIDAD_LABELS[plan.PlanModalidad || "MENSUAL"] ||
        plan.PlanModalidad ||
        "Mensual",
    },
    {
      key: "PlanCantidadClases",
      label: "Cupo (clases)",
      render: (plan: Plan) =>
        plan.PlanModalidad === "CLASES" ? String(plan.PlanCantidadClases ?? 0) : "—",
    },
    {
      key: "PlanActivo",
      label: "Activo",
      render: (plan: Plan) =>
        plan.PlanActivo === 1 || plan.PlanActivo === true ? "Sí" : "No",
    },
  ];

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="flex-1">
          <SearchButton
            searchTerm={searchTerm}
            onSearch={onSearch}
            onKeyPress={onKeyPress}
            onSearchSubmit={onSearchSubmit}
            placeholder="Buscar planes"
          />
        </div>
        <div className="py-4">
          {onCreate && (
            <ActionButton
              label="Nuevo Plan"
              onClick={onCreate}
              icon={PlusIcon}
            />
          )}
        </div>
      </div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-gray-600">
          Mostrando {planes.length} de {pagination?.totalItems} planes
        </div>
      </div>
      <DataTable<Plan>
        columns={columns}
        data={planes}
        onEdit={onEdit}
        onDelete={onDelete}
        emptyMessage="No se encontraron planes"
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={onSort}
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
              aria-labelledby="plan-modal-title"
              className="relative bg-white rounded-lg shadow max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between p-4 border-b rounded-t">
                <h3
                  id="plan-modal-title"
                  className="text-xl font-semibold text-gray-900"
                >
                  {currentPlan
                    ? `Editar plan: ${currentPlan.PlanId}`
                    : "Crear nuevo plan"}
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
                      htmlFor="PlanNombre"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Nombre
                    </label>
                    <input
                      type="text"
                      name="PlanNombre"
                      id="PlanNombre"
                      value={formData.PlanNombre}
                      onChange={(e) => {
                        const value = e.target.value.toUpperCase();
                        handleInputChange({
                          target: {
                            name: "PlanNombre",
                            value: value,
                          },
                        } as React.ChangeEvent<HTMLInputElement>);
                      }}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="PlanDuracion"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Vigencia (días)
                    </label>
                    <input
                      type="number"
                      name="PlanDuracion"
                      id="PlanDuracion"
                      value={formData.PlanDuracion || ""}
                      placeholder={
                        formData.PlanModalidad === "OPEN" ? "365" : "30"
                      }
                      onChange={handleInputChange}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      min="1"
                      required
                    />
                    {formData.PlanModalidad === "OPEN" && (
                      <p className="mt-1 text-xs text-gray-500">
                        Pase libre = el alumno puede ingresar sin lista durante
                        la vigencia. Sugerencia: 365 días (anual).
                      </p>
                    )}
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="PlanPrecio"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Precio
                    </label>
                    <input
                      type="text"
                      name="PlanPrecio"
                      id="PlanPrecio"
                      value={
                        formData.PlanPrecio
                          ? formatMiles(formData.PlanPrecio)
                          : formData.PlanModalidad === "OPEN"
                          ? "0"
                          : ""
                      }
                      placeholder="0"
                      inputMode="numeric"
                      onChange={(e) => {
                        const raw = e.target.value
                          .replace(/\./g, "")
                          .replace(/\s/g, "");
                        if (raw === "") {
                          setFormData((prev) => ({ ...prev, PlanPrecio: 0 }));
                          return;
                        }
                        const num = Number(raw);
                        if (!isNaN(num)) {
                          setFormData((prev) => ({ ...prev, PlanPrecio: num }));
                        }
                      }}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required={formData.PlanModalidad !== "OPEN"}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="PlanPermiteClases"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Permite Clases
                    </label>
                    <select
                      name="PlanPermiteClases"
                      id="PlanPermiteClases"
                      value={formData.PlanPermiteClases ? "1" : "0"}
                      onChange={(e) => {
                        setFormData((prev) => ({
                          ...prev,
                          PlanPermiteClases: e.target.value === "1",
                        }));
                      }}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    >
                      <option value="0">No</option>
                      <option value="1">Sí</option>
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="PlanActivo"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Activo
                    </label>
                    <select
                      name="PlanActivo"
                      id="PlanActivo"
                      value={formData.PlanActivo ? "1" : "0"}
                      onChange={(e) => {
                        setFormData((prev) => ({
                          ...prev,
                          PlanActivo: e.target.value === "1",
                        }));
                      }}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    >
                      <option value="0">No</option>
                      <option value="1">Sí</option>
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label
                      htmlFor="PlanModalidad"
                      className="block mb-2 text-sm font-medium text-gray-900"
                    >
                      Modalidad de inscripción
                    </label>
                    <select
                      name="PlanModalidad"
                      id="PlanModalidad"
                      value={formData.PlanModalidad}
                      onChange={(e) => {
                        const nueva = e.target.value;
                        setFormData((prev) => {
                          // Cambio de modalidad. Antes pasaba a OPEN ponía
                          // PlanDuracion=0 — eso causaba que la suscripción
                          // venza el mismo día. Ahora si el operador no había
                          // tipeado nada (o estaba en 0), sugerimos 365 para
                          // OPEN (vigencia típica de un pase libre anual).
                          const yaTenia = Number(prev.PlanDuracion) > 0;
                          const nuevaDuracion =
                            nueva === "OPEN" && !yaTenia ? 365 : prev.PlanDuracion;
                          return {
                            ...prev,
                            PlanModalidad: nueva,
                            PlanCantidadClases:
                              nueva === "CLASES" ? prev.PlanCantidadClases : 0,
                            PlanDuracion: nuevaDuracion,
                          };
                        });
                      }}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    >
                      <option value="MENSUAL">Mensual (por días)</option>
                      <option value="CLASES">Por clases (cupo)</option>
                      <option value="OPEN">Pase libre / Open</option>
                    </select>
                  </div>
                  {formData.PlanModalidad === "CLASES" && (
                    <div className="col-span-6 sm:col-span-3">
                      <label
                        htmlFor="PlanCantidadClases"
                        className="block mb-2 text-sm font-medium text-gray-900"
                      >
                        Cantidad de clases (cupo)
                      </label>
                      <input
                        type="number"
                        name="PlanCantidadClases"
                        id="PlanCantidadClases"
                        value={formData.PlanCantidadClases || ""}
                        placeholder="12"
                        min={1}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            PlanCantidadClases: Number(e.target.value) || 0,
                          }))
                        }
                        className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        required
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center p-6 space-x-2 border-t border-gray-200 rounded-b">
                <ActionButton
                  label={
                    submitting
                      ? "Guardando..."
                      : currentPlan
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
    </>
  );
}
