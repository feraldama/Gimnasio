import { useEffect, useRef, useState, useCallback } from "react";
import {
  getAllClientesSinPaginacion,
  createCliente as createClienteService,
} from "../services/clientes.service";
import { getPlanes } from "../services/planes.service";
import type { Cliente } from "../components/common/ClienteFormModal";
import Swal from "sweetalert2";

// Tipo Cliente unificado: usamos el canónico de ClienteFormModal (el que espera
// ClienteModal) para que no haya dos definiciones divergentes. Antes este hook
// declaraba su propia versión estricta (ClienteId: number, sin index signature)
// que no era asignable a la del modal y generaba errores de TS en cada uso.
export type { Cliente };

export interface Plan {
  PlanId: string | number;
  PlanNombre: string;
  PlanDuracion: number;
  PlanPrecio?: number;
  PlanActivo?: boolean | number;
  PlanModalidad?: "MENSUAL" | "CLASES" | "OPEN" | string;
  PlanCantidadClases?: number;
  [key: string]: unknown;
}

interface UseClientesPlanesOptions {
  /** Se invoca cuando carga (o se crea) y queda seleccionado un nuevo cliente. */
  onClienteSelected?: (cliente: Cliente) => void;
  /** UsuarioId del operador (para asociar al cliente creado). */
  currentUserId?: string | number;
}

/**
 * Encapsula la carga de clientes y planes, junto con el flujo
 * "seleccionar cliente / crear cliente nuevo / re-cargar lista".
 *
 * Originalmente duplicado entre SuscripcionesList y CrearPagoModal (~150 LOC).
 * El hook expone los datos y los handlers, pero deja que cada componente
 * decida qué setFormData propio invocar al elegir el cliente.
 */
export function useClientesPlanes({
  onClienteSelected,
  currentUserId,
}: UseClientesPlanesOptions = {}) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [clienteSeleccionado, setClienteSeleccionadoState] =
    useState<Cliente | null>(null);
  const [showClienteModal, setShowClienteModal] = useState(false);

  // Ref espejo: necesario porque cuando se crea un cliente nuevo y se recarga
  // la lista, hay que poder identificar al cliente "vivo" entre re-renders
  // sin causar dependencias circulares en useEffect.
  const clienteSeleccionadoRef = useRef<Cliente | null>(null);

  const setClienteSeleccionado = useCallback((cliente: Cliente | null) => {
    setClienteSeleccionadoState(cliente);
    clienteSeleccionadoRef.current = cliente;
  }, []);

  const sortClientesByNombre = (lista: Cliente[]): Cliente[] =>
    [...lista].sort((a, b) => {
      const na = `${a.ClienteNombre || ""} ${a.ClienteApellido || ""}`
        .trim()
        .toUpperCase();
      const nb = `${b.ClienteNombre || ""} ${b.ClienteApellido || ""}`
        .trim()
        .toUpperCase();
      return na.localeCompare(nb);
    });

  // Carga inicial: clientes + planes en paralelo
  useEffect(() => {
    getAllClientesSinPaginacion()
      .then((data) => setClientes(sortClientesByNombre(data.data || [])))
      .catch(() => setClientes([]));

    getPlanes(1, 1000)
      .then((data) => setPlanes(data.data || []))
      .catch(() => setPlanes([]));
  }, []);

  // Cuando la lista de clientes cambia, refrescamos los datos del cliente
  // seleccionado (su nombre/apellido/etc pudo haber sido editado).
  useEffect(() => {
    if (!clienteSeleccionadoRef.current || clientes.length === 0) return;
    const actualizado = clientes.find(
      (c) =>
        Number(c.ClienteId) ===
        Number(clienteSeleccionadoRef.current?.ClienteId)
    );
    if (
      actualizado &&
      actualizado !== clienteSeleccionadoRef.current
    ) {
      setClienteSeleccionado(actualizado);
    }
  }, [clientes, setClienteSeleccionado]);

  const selectCliente = useCallback(
    (cliente: Cliente) => {
      setClienteSeleccionado(cliente);
      setShowClienteModal(false);
      onClienteSelected?.(cliente);
    },
    [setClienteSeleccionado, onClienteSelected]
  );

  /**
   * Crea un cliente nuevo, recarga la lista, lo selecciona automáticamente y
   * muestra un toast de éxito. Errores se reportan también vía SweetAlert.
   */
  const createAndSelectCliente = useCallback(
    async (clienteData: Cliente) => {
      try {
        const nuevoCliente = await createClienteService({
          ClienteId: clienteData.ClienteId,
          ClienteRUC: clienteData.ClienteRUC || "",
          ClienteNombre: clienteData.ClienteNombre,
          ClienteApellido: clienteData.ClienteApellido || "",
          ClienteDireccion: clienteData.ClienteDireccion || "",
          ClienteTelefono: clienteData.ClienteTelefono || "",
          ClienteTipo: "MI",
          ClienteFechaNacimiento: clienteData.ClienteFechaNacimiento || null,
          UsuarioId: String(currentUserId || ""),
        });

        const response = await getAllClientesSinPaginacion();
        const ordenados = sortClientesByNombre(response.data || []);
        setClientes(ordenados);

        const completo =
          ordenados.find(
            (c) =>
              Number(c.ClienteId) === Number(nuevoCliente.data.ClienteId)
          ) || nuevoCliente.data;

        selectCliente(completo);

        Swal.fire({
          icon: "success",
          title: "Cliente creado exitosamente",
          text: "El cliente ha sido creado y seleccionado",
        });
      } catch (error) {
        console.error("Error al crear cliente:", error);
        Swal.fire({
          icon: "error",
          title: "Error al crear cliente",
          text: "Hubo un problema al crear el cliente",
        });
      }
    },
    [currentUserId, selectCliente]
  );

  return {
    clientes,
    planes,
    clienteSeleccionado,
    setClienteSeleccionado,
    clienteSeleccionadoRef,
    showClienteModal,
    setShowClienteModal,
    selectCliente,
    createAndSelectCliente,
  };
}
