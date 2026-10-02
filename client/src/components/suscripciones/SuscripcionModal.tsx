import React, { useState, useMemo, useEffect, useRef } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Button, TextInput, Badge } from "../common/ui";
import { formatDateLocal, formatMiles } from "../../utils/utils";
import { useFocusTrap } from "../../hooks/useFocusTrap";

/**
 * Buscador de suscripciones, mismo patrón que `ClienteModal`: filtros arriba,
 * tabla paginada abajo, clic en la fila para elegir.
 *
 * Reemplaza al `<select>` que listaba todas las suscripciones cobrables en un
 * combo. Con un puñado de filas daba igual, pero el combo no deja buscar por
 * cédula —que es como el mostrador identifica a la gente—, no muestra la
 * vigencia ni el saldo, y crece sin techo: en un gimnasio se genera una
 * suscripción por socio por mes.
 *
 * Quién decide QUÉ suscripciones son elegibles es el que abre el modal, no
 * este componente: recibe la lista ya filtrada. Así la regla de negocio
 * (no cobrar sobre canceladas ni suspendidas) vive en un solo lugar.
 */

export interface SuscripcionBuscable {
  SuscripcionId: string | number;
  ClienteId?: string | number;
  ClienteNombre?: string;
  ClienteApellido?: string;
  ClienteRUC?: string;
  PlanNombre?: string;
  PlanPrecio?: number;
  SuscripcionFechaInicio?: string;
  SuscripcionFechaFin?: string;
  SuscripcionEstado?: string;
  SaldoPendiente?: number;
  TotalPagado?: number;
  [key: string]: unknown;
}

interface SuscripcionModalProps {
  show: boolean;
  onClose: () => void;
  suscripciones: SuscripcionBuscable[];
  onSelect: (suscripcion: SuscripcionBuscable) => void;
  /** Texto opcional bajo el título, para explicar qué se está listando. */
  descripcion?: string;
}

const ESTADOS: Record<
  string,
  { label: string; tone: "success" | "danger" | "info" | "neutral" | "warning" }
> = {
  A: { label: "Vigente", tone: "success" },
  V: { label: "Vencida", tone: "danger" },
  F: { label: "Futura", tone: "info" },
  C: { label: "Cancelada", tone: "neutral" },
  S: { label: "Suspendida", tone: "warning" },
};

const incluye = (valor: unknown, filtro: string) =>
  String(valor ?? "")
    .toLowerCase()
    .includes(filtro.toLowerCase());

const SuscripcionModal: React.FC<SuscripcionModalProps> = ({
  show,
  onClose,
  suscripciones,
  onSelect,
  descripcion,
}) => {
  const [filtros, setFiltros] = useState({ socio: "", ruc: "", plan: "" });
  const [estado, setEstado] = useState("TODOS");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const filtradas = useMemo(() => {
    return suscripciones.filter((s) => {
      // El socio se busca contra nombre + apellido juntos: tipear "juan
      // perez" tiene que encontrarlo, y con dos campos separados el operador
      // no sabe cuál es cuál cuando el dato vino mal cargado.
      const nombreCompleto = `${s.ClienteNombre || ""} ${
        s.ClienteApellido || ""
      }`.trim();
      if (!incluye(nombreCompleto, filtros.socio)) return false;
      if (!incluye(s.ClienteRUC, filtros.ruc)) return false;
      if (!incluye(s.PlanNombre, filtros.plan)) return false;
      if (estado !== "TODOS" && s.SuscripcionEstado !== estado) return false;
      return true;
    });
  }, [suscripciones, filtros, estado]);

  // Si el filtro deja menos páginas que la actual, la tabla quedaba vacía con
  // el paginador diciendo "página 4". Volver al principio al filtrar.
  useEffect(() => {
    setPage(1);
  }, [filtros, estado, rowsPerPage]);

  const totalPages = Math.ceil(filtradas.length / rowsPerPage);
  const paginadas = filtradas.slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show, onClose]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(show, dialogRef);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black opacity-50" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suscripcion-modal-title"
        className="bg-surface rounded-lg shadow-modal w-full max-w-5xl max-h-[90vh] p-6 relative flex flex-col"
      >
        <button
          aria-label="Cerrar"
          className="absolute top-4 right-4 text-text-subtle hover:text-text transition-colors duration-150 cursor-pointer"
          onClick={onClose}
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
        <div className="mb-4 pr-8">
          <h2
            id="suscripcion-modal-title"
            className="text-xl font-semibold text-text"
          >
            Buscar suscripción
          </h2>
          {descripcion && (
            <p className="mt-1 text-sm text-text-muted">{descripcion}</p>
          )}
        </div>

        <div className="bg-surface-sunken rounded-md p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <TextInput
              label="Socio"
              size="sm"
              placeholder="Nombre o apellido"
              value={filtros.socio}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, socio: e.target.value }))
              }
            />
            <TextInput
              label="CI / RUC"
              size="sm"
              placeholder="Buscar"
              value={filtros.ruc}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, ruc: e.target.value }))
              }
            />
            <TextInput
              label="Plan"
              size="sm"
              placeholder="Buscar"
              value={filtros.plan}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, plan: e.target.value }))
              }
            />
            <div>
              <label
                htmlFor="suscripcion-modal-estado"
                className="block mb-1 text-xs font-medium text-text-muted"
              >
                Estado
              </label>
              <select
                id="suscripcion-modal-estado"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="bg-surface border border-border rounded-md px-2 py-1.5 text-sm text-text w-full focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600"
              >
                <option value="TODOS">Todos</option>
                <option value="A">Vigente</option>
                <option value="V">Vencida</option>
                <option value="F">Futura</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-auto rounded-md border border-border flex-1 min-h-0">
          <table className="min-w-full bg-surface text-sm">
            <thead className="sticky top-0 bg-surface-sunken z-10">
              <tr className="text-text-muted">
                <th className="py-2 px-4 text-left font-medium">CI / RUC</th>
                <th className="py-2 px-4 text-left font-medium">Socio</th>
                <th className="py-2 px-4 text-left font-medium">Plan</th>
                <th className="py-2 px-4 text-left font-medium">Vigencia</th>
                <th className="py-2 px-4 text-left font-medium">Estado</th>
                <th className="py-2 px-4 text-right font-medium">Falta</th>
              </tr>
            </thead>
            <tbody>
              {paginadas.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-text-subtle">
                    No hay suscripciones que coincidan
                  </td>
                </tr>
              )}
              {paginadas.map((s, idx) => {
                const est = ESTADOS[String(s.SuscripcionEstado)] || {
                  label: String(s.SuscripcionEstado || "—"),
                  tone: "neutral" as const,
                };
                const saldo = Number(s.SaldoPendiente ?? s.PlanPrecio ?? 0);
                return (
                  <tr
                    key={s.SuscripcionId}
                    className={`${
                      idx % 2 === 1 ? "bg-surface-sunken/50" : ""
                    } hover:bg-brand-50 cursor-pointer transition-colors duration-150`}
                    onClick={() => onSelect(s)}
                  >
                    <td className="py-2 px-4 font-num">{s.ClienteRUC || ""}</td>
                    <td className="py-2 px-4">
                      {`${s.ClienteNombre || ""} ${
                        s.ClienteApellido || ""
                      }`.trim() || `Cliente ${s.ClienteId}`}
                    </td>
                    <td className="py-2 px-4">{s.PlanNombre || "N/A"}</td>
                    <td className="py-2 px-4 font-num text-text-muted">
                      {s.SuscripcionFechaInicio
                        ? `${formatDateLocal(
                            s.SuscripcionFechaInicio
                          )} – ${formatDateLocal(s.SuscripcionFechaFin || "")}`
                        : "—"}
                    </td>
                    <td className="py-2 px-4">
                      <Badge tone={est.tone}>{est.label}</Badge>
                    </td>
                    <td className="py-2 px-4 text-right font-num">
                      {saldo > 0 ? formatMiles(saldo) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-text-muted font-num">
            {filtradas.length === 0
              ? "0"
              : `${formatMiles((page - 1) * rowsPerPage + 1)} a ${formatMiles(
                  Math.min(page * rowsPerPage, filtradas.length)
                )} de ${formatMiles(filtradas.length)}`}
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="suscripcion-modal-rows"
              className="text-sm text-text-muted"
            >
              Filas por página:
            </label>
            <select
              id="suscripcion-modal-rows"
              className="bg-surface border border-border rounded-md px-2 py-1 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600"
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || totalPages === 0}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuscripcionModal;
