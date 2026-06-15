import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getPagos,
  deletePago,
  searchPagos,
  submitPagos,
  updatePago,
} from "../../services/pagos.service";
import PagosList from "../../components/pagos/PagosList";
import Pagination from "../../components/common/Pagination";
import Swal from "sweetalert2";
import { usePermiso } from "../../hooks/usePermiso";
import { PermissionDenied } from "../../components/common/ui";
import { useAuth } from "../../contexts/useAuth";
import { getEstadoAperturaPorUsuario } from "../../services/registrodiariocaja.service";

interface Pago {
  id: string | number;
  PagoId: string | number;
  SuscripcionId: string | number;
  PagoMonto: number;
  PagoTipo: string;
  PagoFecha: string;
  PagoUsuarioId: string | number;
  ClienteNombre?: string;
  ClienteApellido?: string;
  UsuarioNombre?: string;
  UsuarioApellido?: string;
  [key: string]: unknown;
}

interface Pagination {
  totalItems: number;
  totalPages: number;
  [key: string]: unknown;
}

export default function PagosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cajaVerificada, setCajaVerificada] = useState<boolean | null>(null);
  const [pagosData, setPagosData] = useState<{
    pagos: Pago[];
    pagination: Pagination;
  }>({ pagos: [], pagination: { totalItems: 0, totalPages: 1 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearchTerm, setAppliedSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPago, setCurrentPago] = useState<Pago | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortKey, setSortKey] = useState<string | undefined>("PagoId");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const puedeCrear = usePermiso("PAGOS", "crear");
  const puedeEditar = usePermiso("PAGOS", "editar");
  const puedeEliminar = usePermiso("PAGOS", "eliminar");
  const puedeLeer = usePermiso("PAGOS", "leer");

  const fetchPagos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null); // limpiar error previo para no quedar en pantalla muerta
      let data;
      if (appliedSearchTerm) {
        data = await searchPagos(
          appliedSearchTerm,
          currentPage,
          itemsPerPage,
          sortKey,
          sortOrder
        );
      } else {
        data = await getPagos(currentPage, itemsPerPage, sortKey, sortOrder);
      }
      setPagosData({
        pagos: data.data,
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
    const verificarCaja = async () => {
      if (!user?.id) return;
      try {
        const estado = await getEstadoAperturaPorUsuario(user.id);
        if (estado.cajaId && estado.aperturaId > estado.cierreId) {
          setCajaVerificada(true);
        } else {
          Swal.fire({
            icon: "warning",
            title: "Caja no aperturada",
            text: "Debes aperturar una caja antes de acceder a la gestión de pagos.",
            confirmButtonColor: "#2563eb",
          }).then(() => {
            navigate("/apertura-cierre-caja");
          });
          setCajaVerificada(false);
        }
      } catch {
        setCajaVerificada(false);
      }
    };
    verificarCaja();
  }, [user?.id, navigate]);

  useEffect(() => {
    if (cajaVerificada === true) {
      fetchPagos();
    }
  }, [cajaVerificada, fetchPagos]);

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
      title: "¿Anular este pago?",
      text: "Se registrará un ajuste de egreso en la caja por el mismo monto.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Sí, anular",
      cancelButtonText: "Cancelar",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await deletePago(id);
          Swal.fire({
            icon: "success",
            title: "Pago anulado exitosamente",
          });
          setPagosData((prev) => ({
            ...prev,
            pagos: prev.pagos.filter(
              (pago) => String(pago.PagoId) !== String(id)
            ),
          }));
        } catch (error: unknown) {
          const err = error as { message?: string };
          const msg = err?.message || "No se pudo anular el pago";
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
    setCurrentPago(null);
    setIsModalOpen(true);
  };

  const handleEdit = (pago: Pago) => {
    setCurrentPago(pago);
    setIsModalOpen(true);
  };

  const handleSubmit = async (pagoData: Pago | Pago[]) => {
    let mensaje = "";
    try {
      if (currentPago) {
        await updatePago(currentPago.PagoId, pagoData as Pago);
        mensaje = "Pago actualizado exitosamente";
      } else {
        // Single o lote (multi-método) resuelto en el service, en una sola
        // transacción del backend.
        const response = await submitPagos(pagoData);
        const n = Array.isArray(pagoData) ? pagoData.length : 1;
        mensaje =
          response?.message ||
          (n > 1
            ? `${n} pagos creados exitosamente`
            : "Pago creado exitosamente");
      }
      setIsModalOpen(false);
      Swal.fire({
        position: "top-end",
        icon: "success",
        title: mensaje,
        showConfirmButton: false,
        timer: 2000,
      });
      fetchPagos();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "No se pudo guardar el pago";
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

  if (cajaVerificada === false) return null;

  if (!puedeLeer) return <PermissionDenied resource="los pagos" />;

  if (cajaVerificada !== true)
    return <div>Cargando...</div>;

  if (loading) return <div>Cargando pagos...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="container mx-auto px-4">
      <h1 className="text-2xl font-medium mb-3">Gestión de Pagos</h1>
      <PagosList
        pagos={pagosData.pagos.map((p) => ({ ...p, id: p.PagoId }))}
        onDelete={
          puedeEliminar
            ? (pago) => handleDelete(pago.PagoId as string)
            : undefined
        }
        onEdit={puedeEditar ? handleEdit : undefined}
        onCreate={puedeCrear ? handleCreate : undefined}
        pagination={pagosData.pagination}
        onSearch={handleSearch}
        searchTerm={searchTerm}
        onKeyPress={handleKeyPress}
        onSearchSubmit={applySearch}
        isModalOpen={isModalOpen}
        onCloseModal={() => setIsModalOpen(false)}
        currentPago={
          currentPago ? { ...currentPago, id: currentPago.PagoId } : null
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
        totalPages={pagosData.pagination.totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={handleItemsPerPageChange}
      />
    </div>
  );
}
