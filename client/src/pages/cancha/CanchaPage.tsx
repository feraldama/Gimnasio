import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import {
  getReservas,
  searchReservas,
  deleteReserva,
  getCanchasActivas,
  type Cancha,
  type CanchaReserva,
} from "../../services/cancha.service";
import { getAllClientesSinPaginacion } from "../../services/clientes.service";
import { usePermiso } from "../../hooks/usePermiso";
import {
  Button,
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
  TextInput,
  Badge,
} from "../../components/common/ui";
import Pagination from "../../components/common/Pagination";
import { formatMiles } from "../../utils/utils";
import ReservaFormModal, {
  type ReservaFormInitial,
} from "../../components/cancha/ReservaFormModal";
import type { Cliente as ClienteOpt } from "../../components/common/ClienteFormModal";

interface PaginationMeta {
  totalItems: number;
  totalPages: number;
}

const ESTADO_LABELS: Record<
  string,
  { label: string; tone: "neutral" | "success" | "danger" | "warning" }
> = {
  R: { label: "Reservada", tone: "warning" },
  P: { label: "Pagada", tone: "success" },
  X: { label: "Cancelada", tone: "danger" },
};

function formatHora(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    const m = ts?.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : ts || "—";
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export default function CanchaPage() {
  const puedeLeer = usePermiso("CANCHA", "leer");
  const puedeCrear = usePermiso("CANCHA", "crear");
  const puedeEditar = usePermiso("CANCHA", "editar");
  const puedeEliminar = usePermiso("CANCHA", "eliminar");

  const [reservas, setReservas] = useState<CanchaReserva[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    totalItems: 0,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [clientes, setClientes] = useState<ClienteOpt[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [initial, setInitial] = useState<ReservaFormInitial | undefined>(
    undefined
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const r = appliedSearch
        ? await searchReservas(appliedSearch, page, itemsPerPage)
        : await getReservas(page, itemsPerPage);
      setReservas(r.data);
      setPagination(r.pagination);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cargar reservas");
    } finally {
      setLoading(false);
    }
  }, [page, itemsPerPage, appliedSearch]);

  useEffect(() => {
    if (!puedeLeer) return;
    fetchData();
  }, [puedeLeer, fetchData]);

  useEffect(() => {
    if (!puedeLeer) return;
    (async () => {
      try {
        const [cR, clR] = await Promise.all([
          getCanchasActivas(),
          getAllClientesSinPaginacion(),
        ]);
        setCanchas(cR.data);
        // El service devuelve `{ data: Cliente[] }`. Sin extraer .data, el
        // setState deja `clientes` como objeto wrapper y `.find()` revienta.
        setClientes(clR?.data || []);
      } catch {
        /* silenciar; los selects quedaran vacios */
      }
    })();
  }, [puedeLeer]);

  const handleNew = () => {
    setInitial({
      CanchaId: canchas[0]?.CanchaId ?? 0,
    });
    setModalOpen(true);
  };

  const handleEdit = (r: CanchaReserva) => {
    setInitial({
      CanchaReservaId: r.CanchaReservaId,
      CanchaId: r.CanchaId,
      ClienteId: r.ClienteId ?? null,
      CanchaReservaCliente: r.CanchaReservaCliente || "",
      CanchaReservaFecha: r.CanchaReservaFecha?.slice(0, 10) || "",
      CanchaReservaHoraInicio: formatHora(r.CanchaReservaHoraInicio),
      CanchaReservaHoraFin: formatHora(r.CanchaReservaHoraFin),
      CanchaReservaMonto: r.CanchaReservaMonto || 0,
      CanchaReservaEstado: r.CanchaReservaEstado || "R",
      CanchaReservaObservacion: r.CanchaReservaObservacion || "",
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    const c = await Swal.fire({
      title: "¿Eliminar reserva?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
    });
    if (!c.isConfirmed) return;
    try {
      await deleteReserva(id);
      fetchData();
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo eliminar",
      });
    }
  };

  const canchaNombreById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of canchas) m.set(c.CanchaId, c.CanchaNombre);
    return m;
  }, [canchas]);

  if (!puedeLeer) return <PermissionDenied />;

  return (
    <div className="p-6">
      <Card>
        <CardHeader
          title="Cancha — Reservas"
          description="Registro de reservas de cancha. Las reservas en estado 'Pagada' alimentan el reporte diario."
          actions={
            puedeCrear && (
              <Button
                variant="primary"
                onClick={handleNew}
                className="cursor-pointer"
              >
                Nueva reserva
              </Button>
            )
          }
        />

        <div className="flex gap-2 mb-4">
          <TextInput
            placeholder="Buscar por cliente o cancha..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setAppliedSearch(searchTerm);
                setPage(1);
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              setAppliedSearch(searchTerm);
              setPage(1);
            }}
            className="cursor-pointer"
          >
            Buscar
          </Button>
          {appliedSearch && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchTerm("");
                setAppliedSearch("");
                setPage(1);
              }}
              className="cursor-pointer"
            >
              Limpiar
            </Button>
          )}
        </div>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Cancha</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Horario</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {reservas.map((r) => {
                  const estado =
                    ESTADO_LABELS[r.CanchaReservaEstado] || ESTADO_LABELS.R;
                  return (
                    <tr key={r.CanchaReservaId}>
                      <td className="px-3 py-2">
                        {r.CanchaReservaFecha?.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        {r.CanchaNombre ||
                          canchaNombreById.get(r.CanchaId) ||
                          `Cancha ${r.CanchaId}`}
                      </td>
                      <td className="px-3 py-2">
                        {r.ClienteNombre
                          ? `${r.ClienteNombre} ${r.ClienteApellido ?? ""}`.trim()
                          : r.CanchaReservaCliente || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {formatHora(r.CanchaReservaHoraInicio)} —{" "}
                        {formatHora(r.CanchaReservaHoraFin)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        Gs. {formatMiles(r.CanchaReservaMonto)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge tone={estado.tone}>{estado.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right space-x-2">
                        {puedeEditar && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(r)}
                            className="cursor-pointer"
                          >
                            Editar
                          </Button>
                        )}
                        {puedeEliminar && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDelete(r.CanchaReservaId)}
                            className="cursor-pointer"
                          >
                            Eliminar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {reservas.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      Sin reservas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-4">
              <Pagination
                currentPage={page}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={(n) => {
                  setItemsPerPage(n);
                  setPage(1);
                }}
              />
            </div>
          </div>
        )}
      </Card>

      <ReservaFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchData}
        canchas={canchas}
        clientes={clientes}
        initial={initial}
        puedeCrear={puedeCrear}
        puedeEditar={puedeEditar}
        puedeEliminar={puedeEliminar}
      />
    </div>
  );
}
