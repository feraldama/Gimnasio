import { useEffect, useState, useCallback } from "react";
import {
  getSuscripciones,
  deleteSuscripcion,
  searchSuscripciones,
  createSuscripcion,
  updateSuscripcion,
} from "../../services/suscripciones.service";
import { submitPagos } from "../../services/pagos.service";
import SuscripcionesList from "../../components/suscripciones/SuscripcionesList";
import CrearPagoModal, {
  type PagoSubmitData,
} from "../../components/pagos/CrearPagoModal";
import Pagination from "../../components/common/Pagination";
import Swal from "sweetalert2";
import { usePermiso } from "../../hooks/usePermiso";
import { PermissionDenied } from "../../components/common/ui";
import { addDaysLocal, todayLocalISO } from "../../utils/utils";
import { type EstadoDisplay } from "../../utils/suscripcionEstado";

// El backend filtra por código de estado (A/V/F/C/S); la UI usa nombres largos.
const ESTADO_CODE: Record<string, string> = {
  ACTIVA: "A",
  VENCIDA: "V",
  FUTURA: "F",
  CANCELADA: "C",
  SUSPENDIDA: "S",
};

interface Suscripcion {
  id: string | number;
  SuscripcionId: string | number;
  ClienteId: string | number;
  PlanId: string | number;
  SuscripcionFechaInicio: string;
  SuscripcionFechaFin: string;
  SuscripcionEstado?: string;
  ClienteNombre?: string;
  ClienteApellido?: string;
  PlanNombre?: string;
  EstadoPago?: string;
  [key: string]: unknown;
}

interface Pagination {
  totalItems: number;
  totalPages: number;
  [key: string]: unknown;
}

export default function SuscripcionesPage() {
  const [suscripcionesData, setSuscripcionesData] = useState<{
    suscripciones: Suscripcion[];
    pagination: Pagination;
  }>({ suscripciones: [], pagination: { totalItems: 0, totalPages: 1 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearchTerm, setAppliedSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentSuscripcion, setCurrentSuscripcion] =
    useState<Suscripcion | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortKey, setSortKey] = useState<string | undefined>("SuscripcionId");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [filtroEstado, setFiltroEstado] = useState<EstadoDisplay | "TODOS">(
    "TODOS"
  );
  const [filtroPago, setFiltroPago] = useState<"TODOS" | "PAGADA" | "PENDIENTE">(
    "TODOS"
  );
  const [pagoModalOpen, setPagoModalOpen] = useState(false);
  const [renovarSuscripcion, setRenovarSuscripcion] =
    useState<Suscripcion | null>(null);

  const puedeCrear = usePermiso("SUSCRIPCIONES", "crear");
  const puedeEditar = usePermiso("SUSCRIPCIONES", "editar");
  const puedeEliminar = usePermiso("SUSCRIPCIONES", "eliminar");
  const puedeLeer = usePermiso("SUSCRIPCIONES", "leer");
  const puedePagar = usePermiso("PAGOS", "crear");

  const fetchSuscripciones = useCallback(async () => {
    try {
      setLoading(true);
      setError(null); // limpiar error previo para no quedar en pantalla muerta
      const estadoParam =
        filtroEstado !== "TODOS" ? ESTADO_CODE[filtroEstado] : undefined;
      const pagoParam = filtroPago !== "TODOS" ? filtroPago : undefined;
      let data;
      if (appliedSearchTerm) {
        data = await searchSuscripciones(
          appliedSearchTerm,
          currentPage,
          itemsPerPage,
          sortKey,
          sortOrder,
          estadoParam,
          pagoParam
        );
      } else {
        data = await getSuscripciones(
          currentPage,
          itemsPerPage,
          sortKey,
          sortOrder,
          estadoParam,
          pagoParam
        );
      }
      setSuscripcionesData({
        suscripciones: data.data,
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
  }, [
    currentPage,
    appliedSearchTerm,
    itemsPerPage,
    sortKey,
    sortOrder,
    filtroEstado,
    filtroPago,
  ]);

  // Cambiar un filtro resetea a la primera página (server-side).
  const handleFiltroEstado = (v: EstadoDisplay | "TODOS") => {
    setFiltroEstado(v);
    setCurrentPage(1);
  };
  const handleFiltroPago = (v: "TODOS" | "PAGADA" | "PENDIENTE") => {
    setFiltroPago(v);
    setCurrentPage(1);
  };

  useEffect(() => {
    fetchSuscripciones();
  }, [fetchSuscripciones]);

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
          await deleteSuscripcion(id);
          Swal.fire({
            icon: "success",
            title: "Suscripción eliminada exitosamente",
          });
          setSuscripcionesData((prev) => ({
            ...prev,
            suscripciones: prev.suscripciones.filter(
              (suscripcion) => String(suscripcion.SuscripcionId) !== String(id)
            ),
          }));
        } catch (error: unknown) {
          const err = error as { message?: string };
          const msg = err?.message || "No se pudo eliminar la suscripción";
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
    setCurrentSuscripcion(null);
    setIsModalOpen(true);
  };

  const handleEdit = (suscripcion: Suscripcion) => {
    setCurrentSuscripcion(suscripcion);
    setIsModalOpen(true);
  };

  // Renovación: arma una nueva suscripción heredando cliente y plan, con
  // fecha inicio = MAX(hoy, día siguiente al vencimiento anterior), y abre
  // el modal de pago para cobrar la nueva. El plan en `initialSuscripcion`
  // viene de la suscripción anterior; el monto se sugiere desde el plan.
  const handleRenovar = (suscripcion: Suscripcion) => {
    const hoy = todayLocalISO();
    const finAnterior = (suscripcion.SuscripcionFechaFin || "").split("T")[0];
    const inicioNueva =
      finAnterior && finAnterior >= hoy ? addDaysLocal(finAnterior, 1) : hoy;
    setRenovarSuscripcion({
      ...suscripcion,
      SuscripcionId: "", // forzamos creación de nueva suscripción
      SuscripcionFechaInicio: inicioNueva,
      SuscripcionFechaFin: "", // se recalcula con la duración del plan
    });
    setPagoModalOpen(true);
  };

  // Cambio de estado manual (Cancelar / Suspender / Reactivar).
  // Reactivar = vaciar SuscripcionEstado para que el modelo lo recalcule por fechas.
  const handleCambiarEstado = async (
    suscripcion: Suscripcion,
    nuevoEstado: "C" | "S" | "REACTIVAR",
    titulo: string,
    confirmacion: string,
    confirmText: string
  ) => {
    const result = await Swal.fire({
      title: titulo,
      text: confirmacion,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: confirmText,
      cancelButtonText: "Cancelar",
    });
    if (!result.isConfirmed) return;

    try {
      // Cuando reactivamos, mandamos vacío para que el backend recalcule por fechas.
      const estadoBody = nuevoEstado === "REACTIVAR" ? "" : nuevoEstado;
      await updateSuscripcion(suscripcion.SuscripcionId, {
        ClienteId: suscripcion.ClienteId,
        PlanId: suscripcion.PlanId,
        SuscripcionFechaInicio: (suscripcion.SuscripcionFechaInicio || "").split("T")[0],
        SuscripcionFechaFin: (suscripcion.SuscripcionFechaFin || "").split("T")[0],
        SuscripcionEstado: estadoBody,
      });
      Swal.fire({
        position: "top-end",
        icon: "success",
        title: "Estado actualizado",
        showConfirmButton: false,
        timer: 1500,
      });
      fetchSuscripciones();
    } catch (err) {
      const e = err as { message?: string };
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message || "No se pudo actualizar el estado",
      });
    }
  };

  const handleCancelar = (s: Suscripcion) =>
    handleCambiarEstado(
      s,
      "C",
      "¿Cancelar suscripción?",
      "La suscripción quedará marcada como CANCELADA y el socio no podrá registrar asistencia.",
      "Sí, cancelar"
    );

  const handleSuspender = (s: Suscripcion) =>
    handleCambiarEstado(
      s,
      "S",
      "¿Suspender suscripción?",
      "La suscripción quedará SUSPENDIDA hasta que la reactives. El socio no podrá registrar asistencia.",
      "Sí, suspender"
    );

  const handleReactivar = (s: Suscripcion) =>
    handleCambiarEstado(
      s,
      "REACTIVAR",
      "¿Reactivar suscripción?",
      "Volverá a calcularse el estado según las fechas (Activa, Vencida o Futura).",
      "Sí, reactivar"
    );

  const handlePagoSubmit = async (pagoData: PagoSubmitData) => {
    try {
      await submitPagos(pagoData);
      setPagoModalOpen(false);
      setRenovarSuscripcion(null);
      Swal.fire({
        position: "top-end",
        icon: "success",
        title: "Renovación cobrada exitosamente",
        showConfirmButton: false,
        timer: 2000,
      });
      fetchSuscripciones();
    } catch (err) {
      const e = err as { message?: string };
      Swal.fire({
        icon: "error",
        title: "Error al renovar",
        text: e?.message || "No se pudo registrar el pago de renovación",
      });
    }
  };

  const handleSubmit = async (suscripcionData: Suscripcion) => {
    let mensaje = "";
    try {
      if (currentSuscripcion) {
        await updateSuscripcion(
          currentSuscripcion.SuscripcionId,
          suscripcionData
        );
        mensaje = "Suscripción actualizada exitosamente";
      } else {
        const response = await createSuscripcion(suscripcionData);
        mensaje = response.message || "Suscripción creada exitosamente";
      }
      setIsModalOpen(false);
      Swal.fire({
        position: "top-end",
        icon: "success",
        title: mensaje,
        showConfirmButton: false,
        timer: 2000,
      });
      fetchSuscripciones();
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "No se pudo guardar la suscripción";
      Swal.fire({ icon: "error", title: "Error al guardar", text: msg });
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1);
  };

  if (!puedeLeer) return <PermissionDenied resource="las suscripciones" />;

  if (loading) return <div>Cargando suscripciones...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="container mx-auto px-4">
      <h1 className="text-2xl font-medium mb-3">Gestión de Suscripciones</h1>
      <SuscripcionesList
        suscripciones={suscripcionesData.suscripciones.map((s) => ({
          ...s,
          id: s.SuscripcionId,
        }))}
        onDelete={
          puedeEliminar
            ? (suscripcion) => handleDelete(suscripcion.SuscripcionId as string)
            : undefined
        }
        onEdit={puedeEditar ? handleEdit : undefined}
        onCreate={puedeCrear ? handleCreate : undefined}
        onRenovar={puedePagar ? handleRenovar : undefined}
        onCancelar={puedeEditar ? handleCancelar : undefined}
        onSuspender={puedeEditar ? handleSuspender : undefined}
        onReactivar={puedeEditar ? handleReactivar : undefined}
        pagination={suscripcionesData.pagination}
        onSearch={handleSearch}
        searchTerm={searchTerm}
        onKeyPress={handleKeyPress}
        onSearchSubmit={applySearch}
        isModalOpen={isModalOpen}
        onCloseModal={() => setIsModalOpen(false)}
        currentSuscripcion={
          currentSuscripcion
            ? { ...currentSuscripcion, id: currentSuscripcion.SuscripcionId }
            : null
        }
        onSubmit={handleSubmit}
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={(key, order) => {
          setSortKey(key);
          setSortOrder(order);
          setCurrentPage(1);
        }}
        filtroEstado={filtroEstado}
        filtroPago={filtroPago}
        onFiltroEstadoChange={handleFiltroEstado}
        onFiltroPagoChange={handleFiltroPago}
      />
      <Pagination
        currentPage={currentPage}
        totalPages={suscripcionesData.pagination.totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={handleItemsPerPageChange}
      />
      <CrearPagoModal
        show={pagoModalOpen}
        onClose={() => {
          setPagoModalOpen(false);
          setRenovarSuscripcion(null);
        }}
        onSubmit={handlePagoSubmit}
        initialSuscripcion={renovarSuscripcion}
        modoInicial="nueva"
      />
    </div>
  );
}
