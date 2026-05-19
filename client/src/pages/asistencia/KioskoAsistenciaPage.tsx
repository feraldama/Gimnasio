import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  XMarkIcon,
  CheckCircleIcon,
  XCircleIcon,
  BackspaceIcon,
} from "@heroicons/react/24/outline";
import {
  registrarKioskoAsistencia,
  type EstadoAcceso,
} from "../../services/asistencia.service";
import { usePermiso } from "../../hooks/usePermiso";
import { PermissionDenied } from "../../components/common/ui";
import { formatDateLocal } from "../../utils/utils";

// Pantalla de auto-registro pensada para una tablet en la entrada del gym.
// El cliente tipea su cédula (ClienteRUC) en un teclado on-screen y pulsa
// "Ingresar". El backend resuelve cliente, valida acceso y registra asistencia
// en una sola request. El feedback se muestra 5s y vuelve solo al teclado.

const AUTO_RESET_MS = 5000;

type EstadoUI =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "result"; resp: EstadoAcceso };

export default function KioskoAsistenciaPage() {
  const navigate = useNavigate();
  const puedeLeer = usePermiso("KIOSKOASISTENCIA", "leer");

  const [ci, setCi] = useState("");
  const [estado, setEstado] = useState<EstadoUI>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const limpiar = useCallback(() => {
    setCi("");
    setEstado({ kind: "idle" });
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const programarReset = useCallback(() => {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      limpiar();
    }, AUTO_RESET_MS);
  }, [limpiar]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  // Foco inicial + escuchar teclado físico para tablets con teclado externo
  // o testing en escritorio.
  useEffect(() => {
    if (!puedeLeer) return;
    inputRef.current?.focus();
  }, [puedeLeer]);

  const enviar = useCallback(async () => {
    if (!ci.trim() || estado.kind === "loading") return;
    setEstado({ kind: "loading" });
    try {
      const resp = await registrarKioskoAsistencia(ci.trim());
      setEstado({ kind: "result", resp });
    } catch (e) {
      // El service ya devuelve EstadoAcceso aun en errores.
      setEstado({ kind: "result", resp: e as EstadoAcceso });
    } finally {
      programarReset();
    }
  }, [ci, estado.kind, programarReset]);

  const teclaDigito = (d: string) => {
    if (estado.kind !== "idle") return;
    if (ci.length >= 15) return; // Cédulas paraguayas suelen tener <= 9 chars.
    setCi((v) => v + d);
  };

  const teclaBorrar = () => {
    if (estado.kind !== "idle") return;
    setCi((v) => v.slice(0, -1));
  };

  const teclaLimpiar = () => {
    if (estado.kind !== "idle") return;
    setCi("");
  };

  // Soporte de teclado físico (Enter, Backspace, dígitos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (estado.kind !== "idle") return;
      if (e.key === "Enter") {
        e.preventDefault();
        enviar();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        teclaBorrar();
      } else if (/^\d$/.test(e.key)) {
        e.preventDefault();
        teclaDigito(e.key);
      } else if (e.key === "Escape") {
        teclaLimpiar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.kind, ci]);

  const salir = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* no-op */
    }
    navigate("/asistencia");
  };

  if (!puedeLeer) return <PermissionDenied resource="el kiosko de asistencia" />;

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col">
      {/* Header minimal con botón salir */}
      <div className="flex justify-between items-center p-6">
        <div className="text-xl font-semibold tracking-wide opacity-80">
          Registro de ingreso
        </div>
        <button
          onClick={salir}
          className="text-gray-300 hover:text-white opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
          aria-label="Salir del modo kiosko"
        >
          <XMarkIcon className="w-8 h-8" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-6">
        {estado.kind === "result" ? (
          <Feedback resp={estado.resp} onContinue={limpiar} />
        ) : (
          <Teclado
            ci={ci}
            onDigito={teclaDigito}
            onBorrar={teclaBorrar}
            onLimpiar={teclaLimpiar}
            onEnviar={enviar}
            loading={estado.kind === "loading"}
            inputRef={inputRef}
          />
        )}
      </div>
    </div>
  );
}

// ---------------- Teclado ----------------
interface TecladoProps {
  ci: string;
  onDigito: (d: string) => void;
  onBorrar: () => void;
  onLimpiar: () => void;
  onEnviar: () => void;
  loading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function Teclado({
  ci,
  onDigito,
  onBorrar,
  onLimpiar,
  onEnviar,
  loading,
  inputRef,
}: TecladoProps) {
  const digitos: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-6">
      <div className="text-center">
        <div className="text-2xl mb-2 opacity-80">Ingresá tu cédula</div>
        <div className="text-sm opacity-50">
          Tipea tu número de documento y tocá Ingresar
        </div>
      </div>

      <div className="w-full">
        <input
          ref={inputRef}
          readOnly
          value={ci}
          placeholder="• • • • • • •"
          className="w-full bg-gray-700/50 border-2 border-gray-600 rounded-xl px-6 py-5 text-4xl text-center tracking-[0.3em] tabular-nums font-mono outline-none focus:border-blue-400"
          aria-label="Número de cédula"
        />
      </div>

      <div className="grid grid-cols-3 gap-3 w-full">
        {digitos.map((d) => (
          <button
            key={d}
            onClick={() => onDigito(d)}
            className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-3xl font-medium py-6 rounded-xl transition-colors cursor-pointer select-none"
          >
            {d}
          </button>
        ))}
        <button
          onClick={onLimpiar}
          className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-xl font-medium py-6 rounded-xl transition-colors cursor-pointer select-none"
        >
          Borrar todo
        </button>
        <button
          onClick={() => onDigito("0")}
          className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-3xl font-medium py-6 rounded-xl transition-colors cursor-pointer select-none"
        >
          0
        </button>
        <button
          onClick={onBorrar}
          className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 flex items-center justify-center py-6 rounded-xl transition-colors cursor-pointer select-none"
          aria-label="Borrar último dígito"
        >
          <BackspaceIcon className="w-8 h-8" />
        </button>
      </div>

      <button
        onClick={onEnviar}
        disabled={!ci.trim() || loading}
        className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-2xl font-semibold py-5 rounded-xl transition-colors cursor-pointer select-none"
      >
        {loading ? "Procesando..." : "Ingresar"}
      </button>
    </div>
  );
}

// ---------------- Feedback ----------------
function Feedback({
  resp,
  onContinue,
}: {
  resp: EstadoAcceso;
  onContinue: () => void;
}) {
  const ok = resp.permitido;
  const cliente = resp.cliente;
  const susc = resp.suscripcion;

  const initials =
    (cliente?.ClienteNombre?.[0] || "") +
    (cliente?.ClienteApellido?.[0] || "");

  return (
    <div
      onClick={onContinue}
      className="w-full max-w-2xl flex flex-col items-center gap-6 cursor-pointer select-none"
      role="button"
      aria-label="Continuar"
    >
      <div
        className={`rounded-full p-8 ${
          ok ? "bg-green-500/20" : "bg-red-500/20"
        }`}
      >
        {ok ? (
          <CheckCircleIcon className="w-32 h-32 text-green-400" />
        ) : (
          <XCircleIcon className="w-32 h-32 text-red-400" />
        )}
      </div>

      <div className="text-center">
        {cliente ? (
          <>
            <div className="flex items-center justify-center gap-4 mb-4">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold ${
                  ok ? "bg-green-500/30 text-green-100" : "bg-red-500/30 text-red-100"
                }`}
              >
                {initials.toUpperCase() || "?"}
              </div>
              <div className="text-left">
                <div className="text-3xl font-bold">
                  {cliente.ClienteNombre} {cliente.ClienteApellido || ""}
                </div>
                {ok && (
                  <div className="text-lg text-green-300 mt-1">
                    ¡Bienvenido!
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-3xl font-bold text-red-200 mb-2">
            Acceso denegado
          </div>
        )}

        <div
          className={`text-2xl font-medium mt-2 ${
            ok ? "text-green-300" : "text-red-300"
          }`}
        >
          {resp.motivo}
        </div>

        {susc && ok && (
          <div className="mt-6 inline-block bg-gray-700/50 rounded-xl px-6 py-4 text-left">
            <div className="text-sm uppercase tracking-wider opacity-60 mb-2">
              Plan vigente
            </div>
            <div className="text-xl font-semibold">{susc.PlanNombre}</div>
            <div className="text-sm opacity-80 mt-1">
              Vence el {formatDateLocal(susc.SuscripcionFechaFin)}
            </div>
            {susc.PlanModalidad === "CLASES" && (
              <div className="text-sm opacity-80 mt-1">
                Clases restantes:{" "}
                <strong>{susc.SuscripcionClasesRestantes ?? 0}</strong> /{" "}
                {susc.PlanCantidadClases ?? 0}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="text-sm opacity-40 mt-4">
        Tocá la pantalla para continuar — vuelve solo en 5 segundos
      </div>
    </div>
  );
}
