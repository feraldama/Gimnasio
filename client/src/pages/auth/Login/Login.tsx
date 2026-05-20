import { useState, useEffect, useRef } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useAuth } from "../../../contexts/useAuth";
import { useNavigate } from "react-router-dom";
import {
  EyeIcon,
  EyeSlashIcon,
  UserIcon,
  LockClosedIcon,
  BoltIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";

interface Credentials {
  email: string;
  password: string;
}

function Login() {
  const [credentials, setCredentials] = useState<Credentials>({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    try {
      setSubmitting(true);
      setError("");
      await login(credentials);
      navigate("/dashboard");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Credenciales incorrectas";
      setError(msg || "Credenciales incorrectas");
      setTimeout(() => setError(""), 5000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex bg-slate-50"
      style={{ fontFamily: "'Barlow', 'Inter', system-ui, sans-serif" }}
    >
      {/* ============================================================ */}
      {/*  HERO SIDE (oculto en mobile)                                 */}
      {/* ============================================================ */}
      <div className="hidden lg:flex relative flex-1 overflow-hidden bg-slate-900">
        {/* Gradiente principal */}
        <div className="absolute inset-0 bg-gradient-to-br from-orange-600 via-slate-900 to-green-600 opacity-90" />
        {/* Patrón geométrico (líneas de cancha estilizadas) */}
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.08]"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id="court-grid"
              x="0"
              y="0"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 80 0 L 0 0 0 80"
                fill="none"
                stroke="white"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#court-grid)" />
        </svg>
        {/* Blobs de color para profundidad */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-orange-500 rounded-full blur-3xl opacity-25 pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] bg-green-500 rounded-full blur-3xl opacity-20 pointer-events-none" />

        {/* Contenido del hero */}
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full text-white">
          {/* Top: marca */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
              <BoltIcon className="w-7 h-7 text-orange-400" />
            </div>
            <div
              className="text-2xl font-bold tracking-wide"
              style={{
                fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
                letterSpacing: "0.05em",
              }}
            >
              GIMNASIO <span className="text-orange-400">&</span> CANCHA
            </div>
          </div>

          {/* Middle: tagline grande */}
          <div className="max-w-xl">
            <h1
              className="text-6xl xl:text-7xl font-extrabold leading-[0.95] mb-6 uppercase"
              style={{
                fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
              }}
            >
              Gestioná{" "}
              <span className="text-orange-400">tu club</span>
              <br />
              como un{" "}
              <span className="text-green-400">pro.</span>
            </h1>
            <p className="text-lg xl:text-xl text-white/80 leading-relaxed max-w-md">
              Suscripciones, reservas de cancha, asistencias y reportes — todo
              en un solo lugar.
            </p>
          </div>

          {/* Bottom: features pill */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-sm">
              <TrophyIcon className="w-4 h-4 text-orange-400" />
              <span>Reportes en tiempo real</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-sm">
              <BoltIcon className="w-4 h-4 text-green-400" />
              <span>Reservas con un click</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  FORM SIDE                                                    */}
      {/* ============================================================ */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 lg:max-w-xl xl:max-w-2xl bg-white">
        <div className="w-full max-w-sm">
          {/* Marca mobile (solo visible en mobile, ya que el hero está oculto) */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <BoltIcon className="w-6 h-6 text-white" />
            </div>
            <div
              className="text-xl font-bold tracking-wide text-slate-900"
              style={{
                fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
                letterSpacing: "0.05em",
              }}
            >
              GIMNASIO <span className="text-orange-500">&</span> CANCHA
            </div>
          </div>

          {/* Encabezado */}
          <div className="mb-8">
            <h2
              className="text-4xl font-extrabold text-slate-900 mb-2 uppercase tracking-tight"
              style={{
                fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
              }}
            >
              Bienvenido
            </h2>
            <p className="text-slate-600">
              Ingresá tus credenciales para acceder al sistema.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 animate-shake"
            >
              <svg
                className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="flex-1">
                <strong className="block font-semibold">No pudimos ingresar</strong>
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError("")}
                className="text-red-400 hover:text-red-600 cursor-pointer"
                aria-label="Cerrar"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Usuario */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                Usuario
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserIcon className="w-5 h-5 text-slate-400" />
                </div>
                <input
                  ref={emailInputRef}
                  id="email"
                  name="email"
                  type="text"
                  value={credentials.email}
                  onChange={handleChange}
                  required
                  autoComplete="username"
                  placeholder="tu.usuario"
                  className="block w-full rounded-lg bg-slate-50 border border-slate-200 pl-10 pr-3 py-3 text-slate-900 placeholder:text-slate-400 transition-colors focus:bg-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
              </div>
            </div>

            {/* Contraseña */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <LockClosedIcon className="w-5 h-5 text-slate-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={credentials.password}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="block w-full rounded-lg bg-slate-50 border border-slate-200 pl-10 pr-11 py-3 text-slate-900 placeholder:text-slate-400 transition-colors focus:bg-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer transition-colors"
                  aria-label={
                    showPassword
                      ? "Ocultar contraseña"
                      : "Mostrar contraseña"
                  }
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="w-5 h-5" />
                  ) : (
                    <EyeIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-4 shadow-md shadow-orange-500/30 hover:shadow-lg hover:shadow-orange-500/40 transition-all duration-200 cursor-pointer uppercase tracking-wide"
              style={{
                fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
                letterSpacing: "0.05em",
                fontSize: "1.05rem",
              }}
            >
              {submitting ? (
                <>
                  <svg
                    className="w-5 h-5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="opacity-25"
                    />
                    <path
                      d="M4 12a8 8 0 018-8"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  Ingresando...
                </>
              ) : (
                "Ingresar"
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-10 text-center text-xs text-slate-400">
            © {new Date().getFullYear()} Sistema de gestión Gimnasio &amp;
            Cancha
          </p>
        </div>
      </div>

      {/* Animación shake para errores */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }
        .animate-shake {
          animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-shake { animation: none; }
        }
      `}</style>
    </div>
  );
}

export default Login;
