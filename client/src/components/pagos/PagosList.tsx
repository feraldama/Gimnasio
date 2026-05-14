import { Link } from "react-router-dom";
import SearchButton from "../common/Input/SearchButton";
import ActionButton from "../common/Button/ActionButton";
import DataTable from "../common/Table/DataTable";
import { PlusIcon } from "@heroicons/react/24/outline";
import { formatMiles } from "../../utils/utils";
import { getPagoTipoLabel } from "../../constants/pagoTipos";
import CrearPagoModal from "./CrearPagoModal";

interface Pago {
  id: string | number;
  PagoId: string | number;
  SuscripcionId: string | number;
  PagoMonto: number;
  PagoTipo: string;
  PagoFecha: string;
  PagoUsuarioId: string | number;
  ClienteId?: string | number;
  ClienteNombre?: string;
  ClienteApellido?: string;
  UsuarioNombre?: string;
  UsuarioApellido?: string;
  [key: string]: unknown;
}

interface Pagination {
  totalItems: number;
}

interface PagosListProps {
  pagos: Pago[];
  onDelete?: (item: Pago) => void;
  onEdit?: (item: Pago) => void;
  onCreate?: () => void;
  pagination?: Pagination;
  onSearch: (value: string) => void;
  searchTerm: string;
  onKeyPress?: React.KeyboardEventHandler<HTMLInputElement>;
  onSearchSubmit: () => void;
  isModalOpen: boolean;
  onCloseModal: () => void;
  currentPago?: Pago | null;
  onSubmit: (formData: Pago | Pago[]) => void;
  sortKey?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (key: string, order: "asc" | "desc") => void;
}

export default function PagosList({
  pagos,
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
  currentPago,
  onSubmit,
  sortKey,
  sortOrder,
  onSort,
}: PagosListProps) {
  const formatDate = (dateString: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("es-ES");
  };

  const columns = [
    { key: "PagoId", label: "ID" },
    {
      key: "ClienteNombre",
      label: "Cliente",
      render: (pago: Pago) => {
        const nombre =
          `${pago.ClienteNombre || ""} ${pago.ClienteApellido || ""}`.trim() ||
          "N/A";
        if (!pago.ClienteId) return nombre;
        return (
          <Link
            to={`/clientes/${pago.ClienteId}/historial-gimnasio`}
            className="text-blue-600 hover:underline"
            title="Ver historial del cliente"
          >
            {nombre}
          </Link>
        );
      },
    },
    { key: "SuscripcionId", label: "Suscripción ID" },
    {
      key: "PagoMonto",
      label: "Monto",
      render: (pago: Pago) => `Gs. ${formatMiles(pago.PagoMonto || 0)}`,
    },
    {
      key: "PagoTipo",
      label: "Tipo",
      render: (pago: Pago) => getPagoTipoLabel(pago.PagoTipo),
    },
    {
      key: "PagoFecha",
      label: "Fecha",
      render: (pago: Pago) => formatDate(pago.PagoFecha),
    },
    {
      key: "UsuarioNombre",
      label: "Cobrado por",
      render: (pago: Pago) =>
        `${pago.UsuarioNombre || ""} ${pago.UsuarioApellido || ""}`.trim() ||
        String(pago.PagoUsuarioId || "N/A"),
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
            placeholder="Buscar pagos"
          />
        </div>
        <div className="py-4">
          {onCreate && (
            <ActionButton
              label="Nuevo Pago"
              onClick={onCreate}
              icon={PlusIcon}
            />
          )}
        </div>
      </div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-gray-600">
          Mostrando {pagos.length} de {pagination?.totalItems} pagos
        </div>
      </div>
      <DataTable<Pago>
        columns={columns}
        data={pagos}
        onEdit={onEdit}
        onDelete={onDelete}
        emptyMessage="No se encontraron pagos"
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={onSort}
      />
      <CrearPagoModal
        show={isModalOpen}
        onClose={onCloseModal}
        onSubmit={onSubmit}
        currentPago={
          currentPago ? { ...currentPago, id: currentPago.PagoId } : null
        }
      />
    </>
  );
}
