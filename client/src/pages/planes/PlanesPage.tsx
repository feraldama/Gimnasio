import { useEffect, useState, useCallback } from "react";
import {
  getPlanes,
  deletePlan,
  searchPlanes,
  createPlan,
  updatePlan,
} from "../../services/planes.service";
import PlanesList from "../../components/planes/PlanesList";
import Pagination from "../../components/common/Pagination";
import Swal from "sweetalert2";
import { usePermiso } from "../../hooks/usePermiso";

interface Plan {
  id: string | number;
  PlanId: string | number;
  PlanNombre: string;
  PlanDuracion: number;
  PlanPrecio: number;
  PlanPermiteClases: boolean | number;
  PlanActivo: boolean | number;
  [key: string]: unknown;
}

interface Pagination {
  totalItems: number;
  totalPages: number;
  [key: string]: unknown;
}

export default function PlanesPage() {
  const [planesData, setPlanesData] = useState<{
    planes: Plan[];
    pagination: Pagination;
  }>({ planes: [], pagination: { totalItems: 0, totalPages: 1 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearchTerm, setAppliedSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortKey, setSortKey] = useState<string | undefined>();
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const puedeCrear = usePermiso("PLANES", "crear");
  const puedeEditar = usePermiso("PLANES", "editar");
  const puedeEliminar = usePermiso("PLANES", "eliminar");
  const puedeLeer = usePermiso("PLANES", "leer");

  const fetchPlanes = useCallback(async () => {
    try {
      setLoading(true);
      let data;
      if (appliedSearchTerm) {
        data = await searchPlanes(
          appliedSearchTerm,
          currentPage,
          itemsPerPage,
          sortKey,
          sortOrder
        );
      } else {
        data = await getPlanes(currentPage, itemsPerPage, sortKey, sortOrder);
      }
      setPlanesData({
        planes: data.data,
        pagination: data.pagination,
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error desconocido");
      }
    } finally {
      setLoading(false);
    }
  }, [currentPage, appliedSearchTerm, itemsPerPage, sortKey, sortOrder]);

  useEffect(() => {
    fetchPlanes();
  }, [fetchPlanes]);

  const handleSearch = (term: string) => {
    setSearchTerm(term);
  };

  const applySearch = () => {
    setAppliedSearchTerm(searchTerm);
    setCurrentPage(1);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      applySearch();
    }
  };

  const handleDelete = async (id: string) => {
    Swal.fire({
      title: "¿Estás seguro?",
      text: "¡No podrás revertir esto!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Sí, eliminar!",
      cancelButtonText: "Cancelar",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await deletePlan(id);
          Swal.fire({
            icon: "success",
            title: "Plan eliminado exitosamente",
          });
          setPlanesData((prev) => ({
            ...prev,
            planes: prev.planes.filter((plan) => plan.PlanId !== id),
          }));
        } catch (error: unknown) {
          const err = error as { message?: string };
          const msg = err?.message || "No se pudo eliminar el plan";
          Swal.fire({
            icon: "warning",
            title: "No permitido",
            text: msg,
          });
        }
      }
    });
  };

  const handleCreate = () => {
    setCurrentPlan(null);
    setIsModalOpen(true);
  };

  const handleEdit = (plan: Plan) => {
    setCurrentPlan(plan);
    setIsModalOpen(true);
  };

  const handleSubmit = async (planData: Plan) => {
    let mensaje = "";
    try {
      if (currentPlan) {
        await updatePlan(currentPlan.PlanId, planData);
        mensaje = "Plan actualizado exitosamente";
      } else {
        const response = await createPlan(planData);
        mensaje = response.message || "Plan creado exitosamente";
      }
      setIsModalOpen(false);
      Swal.fire({
        position: "top-end",
        icon: "success",
        title: mensaje,
        showConfirmButton: false,
        timer: 2000,
      });
      fetchPlanes();
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Error desconocido");
      }
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1);
  };

  if (!puedeLeer) return <div>No tienes permiso para ver los planes</div>;

  if (loading) return <div>Cargando planes...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="container mx-auto px-4">
      <h1 className="text-2xl font-medium mb-3">Gestión de Planes</h1>
      <PlanesList
        planes={planesData.planes.map((p) => ({ ...p, id: p.PlanId }))}
        onDelete={
          puedeEliminar
            ? (plan) => handleDelete(plan.PlanId as string)
            : undefined
        }
        onEdit={puedeEditar ? handleEdit : undefined}
        onCreate={puedeCrear ? handleCreate : undefined}
        pagination={planesData.pagination}
        onSearch={handleSearch}
        searchTerm={searchTerm}
        onKeyPress={handleKeyPress}
        onSearchSubmit={applySearch}
        isModalOpen={isModalOpen}
        onCloseModal={() => setIsModalOpen(false)}
        currentPlan={
          currentPlan ? { ...currentPlan, id: currentPlan.PlanId } : null
        }
        onSubmit={handleSubmit}
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={(key, order) => {
          setSortKey(key);
          setSortOrder(order);
          setCurrentPage(1);
        }}
      />
      <Pagination
        currentPage={currentPage}
        totalPages={planesData.pagination.totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={handleItemsPerPageChange}
      />
    </div>
  );
}
