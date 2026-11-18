import { useState, type MouseEvent } from "react";
import Swal from "sweetalert2";
import { PrinterIcon } from "@heroicons/react/24/outline";
import Button from "./Button";
import { useAuth } from "../../../contexts/useAuth";
import { reimprimirTicketCierre } from "../../../utils/ticketCierreCaja";

/**
 * Reimprime el ticket de cierre de un turno cerrado, igual al que imprime el
 * cajero al cerrar (utils/ticketCierreCaja.ts). Lo usan Corrección de caja y
 * el reporte "Cierre de caja por rango".
 */
export default function BotonTicketCierre({
  aperturaId,
  compacto = false,
}: {
  aperturaId: number;
  compacto?: boolean;
}) {
  const { user } = useAuth();
  const [cargando, setCargando] = useState(false);

  const imprimir = async (e: MouseEvent) => {
    // Va dentro de filas clickeables: que no las abra/cierre.
    e.stopPropagation();
    setCargando(true);
    try {
      await reimprimirTicketCierre(aperturaId, user?.nombre || user?.id || "");
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "No se pudo generar el ticket",
        text: (err as { message?: string })?.message || "Intentá de nuevo.",
        confirmButtonColor: "#2563eb",
      });
    } finally {
      setCargando(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      leftIcon={PrinterIcon}
      loading={cargando}
      onClick={imprimir}
      title="Reimprimir el ticket de cierre de este turno"
      aria-label="Ticket de cierre"
    >
      {compacto ? "Ticket" : "Ticket de cierre"}
    </Button>
  );
}
