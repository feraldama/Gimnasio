import { useEffect, useState } from "react";
import { getAllSuscripcionesSinPaginacion } from "../../services/suscripciones.service";
import ClienteModal from "../common/ClienteModal";
import { addDaysLocal, formatMiles, todayLocalISO } from "../../utils/utils";
import { PAGO_TIPOS_LIST } from "../../constants/pagoTipos";
import Swal from "sweetalert2";
import { useAuth } from "../../contexts/useAuth";
import {
  useClientesPlanes,
  type Plan,
} from "../../hooks/useClientesPlanes";

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
  [key: string]: unknown;
}

interface Suscripcion {
  SuscripcionId: string | number;
  ClienteId?: string | number;
  PlanId?: string | number;
  SuscripcionFechaInicio?: string;
  SuscripcionFechaFin?: string;
  ClienteNombre?: string;
  ClienteApellido?: string;
  PlanNombre?: string;
  PlanPrecio?: number;
  EstadoPago?: string;
  [key: string]: unknown;
}

const isPlanActivo = (plan: Plan) =>
  plan.PlanActivo === 1 || plan.PlanActivo === true;

/** Un pago individual o array de pagos (cuando se divide en varios métodos) */
export type PagoSubmitData = Pago | Pago[];

interface CrearPagoModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: (formData: PagoSubmitData) => void;
  currentPago?: Pago | null;
  initialSuscripcion?: Suscripcion | null;
  /** "existente" = pago de suscripción existente, "nueva" = crear nueva suscripción con cliente/plan pre-seleccionados */
  modoInicial?: "existente" | "nueva";
}

export default function CrearPagoModal({
  show,
  onClose,
  onSubmit,
  currentPago,
  initialSuscripcion,
  modoInicial = "existente",
}: CrearPagoModalProps) {
  const [formData, setFormData] = useState({
    id: "",
    PagoId: "",
    SuscripcionId: "",
    PagoMonto: 0,
    PagoTipo: "",
    PagoFecha: "",
    PagoUsuarioId: "",
  });
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [suscripcionSeleccionada, setSuscripcionSeleccionada] =
    useState<Suscripcion | null>(null);
  const [tipoPago, setTipoPago] = useState<"nueva" | "existente">("nueva");
  const [suscripcionFormData, setSuscripcionFormData] = useState({
    ClienteId: "",
    PlanId: "",
    SuscripcionFechaInicio: "",
    SuscripcionFechaFin: "",
  });
  const [fechaError, setFechaError] = useState<string>("");
  const { user } = useAuth();
  const {
    clientes,
    planes,
    clienteSeleccionado,
    setClienteSeleccionado,
    showClienteModal,
    setShowClienteModal,
    selectCliente,
    createAndSelectCliente,
  } = useClientesPlanes({
    currentUserId: user?.id,
    onClienteSelected: (cliente) =>
      setSuscripcionFormData((prev) => ({
        ...prev,
        ClienteId: String(cliente.ClienteId),
      })),
  });

  // Montos por método de pago (solo para creación, cuando no hay currentPago)
  const [contado, setContado] = useState(0);
  const [pos, setPos] = useState(0);
  const [transferencia, setTransferencia] = useState(0);
  const [pagoTipoActivo, setPagoTipoActivo] = useState<"CO" | "PO" | "TR">(
    "CO",
  );

  useEffect(() => {
    if (!show) return;

    getAllSuscripcionesSinPaginacion()
      .then((data) => {
        const todasSuscripciones = data.data || [];
        let suscripcionesPendientes = todasSuscripciones.filter(
          (s: Suscripcion) => s.EstadoPago !== "PAGADA",
        );
        if (initialSuscripcion) {
          const yaIncluida = suscripcionesPendientes.some(
            (s: Suscripcion) =>
              String(s.SuscripcionId) ===
              String(initialSuscripcion.SuscripcionId),
          );
          if (!yaIncluida) {
            suscripcionesPendientes = [
              initialSuscripcion,
              ...suscripcionesPendientes,
            ];
          }
        }
        setSuscripciones(suscripcionesPendientes);
      })
      .catch(() =>
        setSuscripciones(initialSuscripcion ? [initialSuscripcion] : []),
      );
    // clientes y planes los carga useClientesPlanes
  }, [show, initialSuscripcion]);

  useEffect(() => {
    if (!show) return;

    if (currentPago) {
      getAllSuscripcionesSinPaginacion()
        .then((data) => {
          const todasSuscripciones = data.data || [];
          const suscripcion = todasSuscripciones.find(
            (s: Suscripcion) =>
              String(s.SuscripcionId) === String(currentPago.SuscripcionId),
          );
          setSuscripcionSeleccionada(suscripcion || null);
        })
        .catch(() => setSuscripcionSeleccionada(null));

      setFormData({
        id: String(currentPago.id ?? currentPago.PagoId),
        PagoId: String(currentPago.PagoId),
        SuscripcionId: String(currentPago.SuscripcionId),
        PagoMonto: currentPago.PagoMonto || 0,
        PagoTipo: currentPago.PagoTipo || "",
        PagoFecha: currentPago.PagoFecha
          ? currentPago.PagoFecha.split("T")[0]
          : "",
        PagoUsuarioId: String(currentPago.PagoUsuarioId || user?.id || ""),
      });
      setTipoPago("existente");
    } else if (initialSuscripcion && modoInicial === "existente") {
      setTipoPago("existente");
      setSuscripcionSeleccionada(initialSuscripcion);
      setFormData({
        id: "",
        PagoId: "",
        SuscripcionId: String(initialSuscripcion.SuscripcionId),
        PagoMonto: initialSuscripcion.PlanPrecio || 0,
        PagoTipo: "",
        PagoFecha: todayLocalISO(),
        PagoUsuarioId: String(user?.id || ""),
      });
      setContado(0);
      setPos(0);
      setTransferencia(0);
    } else if (initialSuscripcion && modoInicial === "nueva") {
      const hoy = todayLocalISO();
      setTipoPago("nueva");
      setSuscripcionSeleccionada(null);
      setFormData({
        id: "",
        PagoId: "",
        SuscripcionId: "",
        PagoMonto: initialSuscripcion.PlanPrecio || 0,
        PagoTipo: "",
        PagoFecha: hoy,
        PagoUsuarioId: String(user?.id || ""),
      });
      setSuscripcionFormData({
        ClienteId: String(initialSuscripcion.ClienteId || ""),
        PlanId: String(initialSuscripcion.PlanId || ""),
        SuscripcionFechaInicio: hoy,
        SuscripcionFechaFin: "",
      });
      setContado(0);
      setPos(0);
      setTransferencia(0);
    } else {
      setFormData({
        id: "",
        PagoId: "",
        SuscripcionId: "",
        PagoMonto: 0,
        PagoTipo: "",
        PagoFecha: todayLocalISO(),
        PagoUsuarioId: String(user?.id || ""),
      });
      setSuscripcionSeleccionada(null);
      setTipoPago("nueva");
      setClienteSeleccionado(null);
      setSuscripcionFormData({
        ClienteId: "",
        PlanId: "",
        SuscripcionFechaInicio: todayLocalISO(),
        SuscripcionFechaFin: "",
      });
      setFechaError("");
      setContado(0);
      setPos(0);
      setTransferencia(0);
    }
  }, [show, currentPago, initialSuscripcion, modoInicial, user]);

  // Cuando modoInicial es "nueva", pre-seleccionar cliente y calcular fecha fin cuando clientes/planes carguen
  useEffect(() => {
    if (
      !show ||
      !initialSuscripcion ||
      modoInicial !== "nueva" ||
      clientes.length === 0 ||
      planes.length === 0
    )
      return;

    const cliente = clientes.find(
      (c) => Number(c.ClienteId) === Number(initialSuscripcion.ClienteId),
    );
    if (cliente) {
      setClienteSeleccionado(cliente);
    }

    const fechaInicio = todayLocalISO();
    const fechaFin = (() => {
      const plan = planes.find(
        (p) => Number(p.PlanId) === Number(initialSuscripcion.PlanId),
      );
      if (!plan?.PlanDuracion) return "";
      return addDaysLocal(fechaInicio, plan.PlanDuracion);
    })();
    if (fechaFin) {
      setSuscripcionFormData((prev) => ({
        ...prev,
        SuscripcionFechaInicio: fechaInicio,
        SuscripcionFechaFin: fechaFin,
      }));
    }
  }, [show, initialSuscripcion, modoInicial, clientes, planes]);

  const calculateFechaFin = (fechaInicio: string, planId: string | number) => {
    if (!fechaInicio || !planId) return "";
    const plan = planes.find((p) => Number(p.PlanId) === Number(planId));
    if (!plan || !plan.PlanDuracion) return "";
    return addDaysLocal(fechaInicio, plan.PlanDuracion);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "PagoMonto" ? Number(value) : value,
    }));
    if (name === "SuscripcionId" && value) {
      const suscripcion = suscripciones.find(
        (s) => String(s.SuscripcionId) === String(value),
      );
      if (suscripcion) {
        setSuscripcionSeleccionada(suscripcion);
        if (suscripcion.PlanPrecio) {
          setFormData((prev) => ({
            ...prev,
            SuscripcionId: value,
            PagoMonto: Number(suscripcion.PlanPrecio),
          }));
        } else {
          setFormData((prev) => ({ ...prev, SuscripcionId: value }));
        }
      }
    }
  };

  const handleSuscripcionInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setSuscripcionFormData((prev) => {
      const newData = { ...prev, [name]: value };
      if (name === "SuscripcionFechaInicio" && prev.PlanId) {
        const fechaFin = calculateFechaFin(value, prev.PlanId);
        if (fechaFin) newData.SuscripcionFechaFin = fechaFin;
        setFechaError("");
      }
      if (name === "PlanId" && prev.SuscripcionFechaInicio && value) {
        const fechaFin = calculateFechaFin(prev.SuscripcionFechaInicio, value);
        if (fechaFin) newData.SuscripcionFechaFin = fechaFin;
        const plan = planes.find((p) => Number(p.PlanId) === Number(value));
        if (plan?.PlanPrecio) {
          setFormData((prev) => ({
            ...prev,
            PagoMonto: Number(plan.PlanPrecio),
          }));
        }
        setFechaError("");
      }
      if (name === "SuscripcionFechaFin") {
        const fechaInicio = newData.SuscripcionFechaInicio;
        if (fechaInicio && value) {
          const fechaFinDate = new Date(value);
          const fechaInicioDate = new Date(fechaInicio);
          setFechaError(
            fechaFinDate < fechaInicioDate
              ? "La fecha fin no puede ser anterior a la fecha inicio"
              : "",
          );
        } else setFechaError("");
      }
      if (name === "SuscripcionFechaInicio" && newData.SuscripcionFechaFin) {
        const fechaFinDate = new Date(newData.SuscripcionFechaFin);
        const fechaInicioDate = new Date(value);
        setFechaError(
          fechaFinDate < fechaInicioDate
            ? "La fecha fin no puede ser anterior a la fecha inicio"
            : "",
        );
      }
      return newData;
    });
  };

  // selectCliente / createAndSelectCliente vienen del hook useClientesPlanes.
  // El callback onClienteSelected del hook ya actualiza suscripcionFormData.ClienteId.

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (tipoPago === "nueva") {
      if (!suscripcionFormData.ClienteId || !clienteSeleccionado) {
        Swal.fire({
          icon: "warning",
          title: "Cliente requerido",
          text: "Debe seleccionar un cliente",
        });
        return;
      }
      if (!suscripcionFormData.PlanId) {
        Swal.fire({
          icon: "warning",
          title: "Plan requerido",
          text: "Debe seleccionar un plan",
        });
        return;
      }
      if (!suscripcionFormData.SuscripcionFechaInicio) {
        Swal.fire({
          icon: "warning",
          title: "Fecha de inicio requerida",
          text: "Debe seleccionar una fecha de inicio",
        });
        return;
      }
      if (!suscripcionFormData.SuscripcionFechaFin) {
        Swal.fire({
          icon: "warning",
          title: "Fecha de fin requerida",
          text: "Debe seleccionar una fecha de fin",
        });
        return;
      }
      const fechaInicioDate = new Date(
        suscripcionFormData.SuscripcionFechaInicio,
      );
      const fechaFinDate = new Date(suscripcionFormData.SuscripcionFechaFin);
      if (fechaFinDate < fechaInicioDate) {
        Swal.fire({
          icon: "error",
          title: "Error de validación",
          text: "La fecha fin no puede ser anterior a la fecha inicio",
        });
        setFechaError("La fecha fin no puede ser anterior a la fecha inicio");
        return;
      }
    } else {
      if (!formData.SuscripcionId) {
        Swal.fire({
          icon: "warning",
          title: "Suscripción requerida",
          text: "Debe seleccionar una suscripción",
        });
        return;
      }
    }
    if (!formData.PagoMonto || formData.PagoMonto <= 0) {
      Swal.fire({
        icon: "warning",
        title: "Monto inválido",
        text: "El monto debe ser mayor a cero",
      });
      return;
    }

    const totalDistribuido = contado + pos + transferencia;

    if (currentPago) {
      // Modo edición: un solo pago
      if (!formData.PagoTipo) {
        Swal.fire({
          icon: "warning",
          title: "Tipo requerido",
          text: "Debe seleccionar un tipo de pago",
        });
        return;
      }
      const formDataToSubmit = {
        ...formData,
        SuscripcionId: formData.SuscripcionId,
        PagoUsuarioId: user?.id || formData.PagoUsuarioId,
      } as Pago;
      onSubmit(formDataToSubmit);
      return;
    }

    // Modo creación: validar distribución
    if (totalDistribuido <= 0) {
      Swal.fire({
        icon: "warning",
        title: "Distribución requerida",
        text: "Debe ingresar al menos un monto en Contado, POS o Transferencia",
      });
      return;
    }
    if (totalDistribuido !== formData.PagoMonto) {
      Swal.fire({
        icon: "warning",
        title: "La suma no coincide",
        text: `La suma de los métodos (${formatMiles(totalDistribuido)}) debe ser igual al total (${formatMiles(formData.PagoMonto)})`,
      });
      return;
    }

    const baseData: Record<string, unknown> = {
      PagoFecha: formData.PagoFecha,
      PagoUsuarioId: user?.id || formData.PagoUsuarioId,
    };
    if (tipoPago === "nueva") {
      baseData.ClienteId = suscripcionFormData.ClienteId;
      baseData.PlanId = suscripcionFormData.PlanId;
      baseData.SuscripcionFechaInicio =
        suscripcionFormData.SuscripcionFechaInicio;
      baseData.SuscripcionFechaFin = suscripcionFormData.SuscripcionFechaFin;
    } else {
      baseData.SuscripcionId = formData.SuscripcionId;
    }

    const pagosToCreate: Pago[] = [];
    if (contado > 0) {
      pagosToCreate.push({
        ...baseData,
        PagoMonto: contado,
        PagoTipo: "CO",
      } as Pago);
    }
    if (pos > 0) {
      pagosToCreate.push({
        ...baseData,
        PagoMonto: pos,
        PagoTipo: "PO",
      } as Pago);
    }
    if (transferencia > 0) {
      pagosToCreate.push({
        ...baseData,
        PagoMonto: transferencia,
        PagoTipo: "TR",
      } as Pago);
    }

    onSubmit(pagosToCreate);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!show) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={handleBackdropClick}
      >
        <div className="absolute inset-0 bg-black opacity-50" />
        <div className="relative w-full max-w-2xl max-h-full z-10">
          <form
            onSubmit={handleSubmit}
            className="relative bg-white rounded-lg shadow max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-4 border-b rounded-t">
              <h3 className="text-xl font-semibold text-gray-900">
                {currentPago
                  ? `Editar pago: ${currentPago.PagoId}`
                  : "Crear nuevo pago"}
              </h3>
              <button
                type="button"
                className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 ml-auto inline-flex items-center"
                onClick={onClose}
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {!currentPago && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                  <label className="block mb-3 text-sm font-medium text-gray-900">
                    Tipo de pago
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <input
                        type="radio"
                        id="nuevaSuscripcion"
                        name="tipoPago"
                        value="nueva"
                        checked={tipoPago === "nueva"}
                        onChange={(e) => {
                          setTipoPago(e.target.value as "nueva" | "existente");
                          if (e.target.value === "nueva") {
                            setFormData((prev) => ({
                              ...prev,
                              SuscripcionId: "",
                            }));
                            setSuscripcionSeleccionada(null);
                          } else {
                            setClienteSeleccionado(null);
                            setSuscripcionFormData({
                              ClienteId: "",
                              PlanId: "",
                              SuscripcionFechaInicio: new Date()
                                .toISOString()
                                .split("T")[0],
                              SuscripcionFechaFin: "",
                            });
                            setFechaError("");
                          }
                        }}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500"
                      />
                      <label
                        htmlFor="nuevaSuscripcion"
                        className="ml-2 text-sm font-medium text-gray-900 cursor-pointer"
                      >
                        Crear nueva suscripción
                      </label>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="radio"
                        id="suscripcionExistente"
                        name="tipoPago"
                        value="existente"
                        checked={tipoPago === "existente"}
                        onChange={(e) => {
                          setTipoPago(e.target.value as "nueva" | "existente");
                          if (e.target.value === "nueva") {
                            setFormData((prev) => ({
                              ...prev,
                              SuscripcionId: "",
                            }));
                            setSuscripcionSeleccionada(null);
                          } else {
                            setClienteSeleccionado(null);
                            setSuscripcionFormData({
                              ClienteId: "",
                              PlanId: "",
                              SuscripcionFechaInicio: new Date()
                                .toISOString()
                                .split("T")[0],
                              SuscripcionFechaFin: "",
                            });
                            setFechaError("");
                          }
                        }}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500"
                      />
                      <label
                        htmlFor="suscripcionExistente"
                        className="ml-2 text-sm font-medium text-gray-900 cursor-pointer"
                      >
                        Realizar el pago de una suscripción existente
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {tipoPago === "nueva" && !currentPago ? (
                <>
                  <div>
                    <label className="block mb-2 text-sm font-medium text-gray-900">
                      Cliente *
                    </label>
                    <button
                      type="button"
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
                  <div>
                    <label className="block mb-2 text-sm font-medium text-gray-900">
                      Plan *
                    </label>
                    <select
                      name="PlanId"
                      value={suscripcionFormData.PlanId}
                      onChange={handleSuscripcionInputChange}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required
                    >
                      <option value="">Seleccionar plan</option>
                      {planes
                        .filter(
                          (plan) =>
                            isPlanActivo(plan) ||
                            String(plan.PlanId) ===
                              String(suscripcionFormData.PlanId)
                        )
                        .map((plan) => (
                          <option key={plan.PlanId} value={plan.PlanId}>
                            {plan.PlanNombre}
                            {!isPlanActivo(plan) ? " (inactivo)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block mb-2 text-sm font-medium text-gray-900">
                        Fecha Inicio *
                      </label>
                      <input
                        type="date"
                        name="SuscripcionFechaInicio"
                        value={suscripcionFormData.SuscripcionFechaInicio}
                        onChange={handleSuscripcionInputChange}
                        className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        required
                      />
                    </div>
                    <div>
                      <label className="block mb-2 text-sm font-medium text-gray-900">
                        Fecha Fin *
                      </label>
                      <input
                        type="date"
                        name="SuscripcionFechaFin"
                        value={suscripcionFormData.SuscripcionFechaFin}
                        onChange={handleSuscripcionInputChange}
                        min={
                          suscripcionFormData.SuscripcionFechaInicio ||
                          undefined
                        }
                        className={`bg-gray-50 border ${
                          fechaError ? "border-red-500" : "border-gray-300"
                        } text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5`}
                        required
                      />
                      {fechaError && (
                        <p className="mt-1 text-xs text-red-600">
                          {fechaError}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block mb-2 text-sm font-medium text-gray-900">
                      Suscripción *
                    </label>
                    <select
                      name="SuscripcionId"
                      value={formData.SuscripcionId}
                      onChange={handleInputChange}
                      className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                      required={tipoPago === "existente"}
                      disabled={!!currentPago}
                    >
                      <option value="">
                        {currentPago
                          ? "Suscripción del pago (no editable)"
                          : "Seleccione una suscripción"}
                      </option>
                      {suscripciones.map((suscripcion) => (
                        <option
                          key={suscripcion.SuscripcionId}
                          value={suscripcion.SuscripcionId}
                        >
                          ID: {suscripcion.SuscripcionId} -{" "}
                          {suscripcion.ClienteNombre || ""}{" "}
                          {suscripcion.ClienteApellido || ""} - Plan:{" "}
                          {suscripcion.PlanNombre || "N/A"}
                        </option>
                      ))}
                    </select>
                    {!formData.SuscripcionId && tipoPago === "existente" && (
                      <p className="mt-1 text-xs text-red-600">
                        * Debe seleccionar una suscripción
                      </p>
                    )}
                  </div>
                  {suscripcionSeleccionada && (
                    <div>
                      <label className="block mb-2 text-sm font-medium text-gray-900">
                        Plan
                      </label>
                      <input
                        type="text"
                        value={suscripcionSeleccionada.PlanNombre || "N/A"}
                        readOnly
                        disabled
                        className="bg-gray-100 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2.5 cursor-not-allowed"
                      />
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900">
                  Monto total * (Editable)
                </label>
                <input
                  type="text"
                  name="PagoMonto"
                  value={
                    formData.PagoMonto ? formatMiles(formData.PagoMonto) : ""
                  }
                  onChange={(e) => {
                    const raw = e.target.value
                      .replace(/\./g, "")
                      .replace(/\s/g, "");
                    const num = Number(raw);
                    if (!isNaN(num)) {
                      setFormData((prev) => ({ ...prev, PagoMonto: num }));
                    } else if (raw === "") {
                      setFormData((prev) => ({ ...prev, PagoMonto: 0 }));
                    }
                  }}
                  className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                  required
                  placeholder={
                    suscripcionSeleccionada?.PlanPrecio
                      ? formatMiles(suscripcionSeleccionada.PlanPrecio)
                      : "0"
                  }
                />
                {suscripcionSeleccionada?.PlanPrecio && (
                  <p className="mt-1 text-xs text-gray-500">
                    Monto sugerido del plan:{" "}
                    {formatMiles(suscripcionSeleccionada.PlanPrecio)} Gs.
                  </p>
                )}
              </div>

              {/* Distribución del pago por método (solo creación, sin edición) */}
              {!currentPago && (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <label className="block mb-3 text-sm font-medium text-gray-900">
                    Distribuir el pago por método
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Ingrese el monto en cada método. La suma debe coincidir con
                    el total.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="w-28 text-sm text-gray-700">
                        Contado:
                      </label>
                      <input
                        type="text"
                        value={contado ? formatMiles(contado) : ""}
                        onFocus={() => setPagoTipoActivo("CO")}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, "");
                          const num = Number(raw) || 0;
                          setContado(num);
                        }}
                        className={`flex-1 max-w-[140px] p-2 rounded border text-right ${
                          pagoTipoActivo === "CO"
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-300 bg-white"
                        }`}
                        placeholder="0"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="w-28 text-sm text-gray-700">POS:</label>
                      <input
                        type="text"
                        value={pos ? formatMiles(pos) : ""}
                        onFocus={() => setPagoTipoActivo("PO")}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, "");
                          const num = Number(raw) || 0;
                          setPos(num);
                        }}
                        className={`flex-1 max-w-[140px] p-2 rounded border text-right ${
                          pagoTipoActivo === "PO"
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-300 bg-white"
                        }`}
                        placeholder="0"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="w-28 text-sm text-gray-700">
                        Transferencia:
                      </label>
                      <input
                        type="text"
                        value={transferencia ? formatMiles(transferencia) : ""}
                        onFocus={() => setPagoTipoActivo("TR")}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, "");
                          const num = Number(raw) || 0;
                          setTransferencia(num);
                        }}
                        className={`flex-1 max-w-[140px] p-2 rounded border text-right ${
                          pagoTipoActivo === "TR"
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-300 bg-white"
                        }`}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <span className="text-sm text-gray-600">
                      Suma: Gs. {formatMiles(contado + pos + transferencia)}
                    </span>
                    <span
                      className={`text-sm font-medium ${
                        contado + pos + transferencia === formData.PagoMonto &&
                        formData.PagoMonto > 0
                          ? "text-green-600"
                          : contado + pos + transferencia > 0
                            ? "text-amber-600"
                            : "text-gray-500"
                      }`}
                    >
                      {contado + pos + transferencia === formData.PagoMonto &&
                      formData.PagoMonto > 0
                        ? "✓ Coincide"
                        : formData.PagoMonto > 0
                          ? `Restante: Gs. ${formatMiles(Math.max(0, formData.PagoMonto - contado - pos - transferencia))}`
                          : "Ingrese montos"}
                    </span>
                  </div>
                </div>
              )}

              {/* Tipo único (solo en modo edición) */}
              {currentPago && (
                <div>
                  <label className="block mb-2 text-sm font-medium text-gray-900">
                    Tipo *
                  </label>
                  <select
                    name="PagoTipo"
                    value={formData.PagoTipo}
                    onChange={handleInputChange}
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                    required
                  >
                    <option value="">Seleccione un tipo</option>
                    {PAGO_TIPOS_LIST.map((t) => (
                      <option key={t.codigo} value={t.codigo}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900">
                  Fecha Pago *
                </label>
                <input
                  type="date"
                  name="PagoFecha"
                  value={formData.PagoFecha}
                  onChange={handleInputChange}
                  className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                  required
                />
              </div>
            </div>
            <div className="flex items-center p-6 space-x-2 border-t border-gray-200 rounded-b">
              <button
                type="submit"
                className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center cursor-pointer"
              >
                {currentPago ? "Actualizar" : "Crear"}
              </button>
              <button
                type="button"
                className="text-gray-500 bg-white hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 rounded-lg border border-gray-200 text-sm font-medium px-5 py-2.5 hover:text-gray-900 cursor-pointer"
                onClick={onClose}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
      <ClienteModal
        show={showClienteModal}
        onClose={() => setShowClienteModal(false)}
        clientes={clientes}
        onSelect={selectCliente}
        onCreateCliente={createAndSelectCliente}
        currentUserId={user?.id}
        hideTipo={true}
        showFechaNacimiento={true}
      />
    </>
  );
}
