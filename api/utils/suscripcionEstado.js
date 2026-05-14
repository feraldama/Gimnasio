// Estados posibles de una suscripción (columna suscripcion.SuscripcionEstado char(1)).
// A = Activa  (hoy está dentro del rango de vigencia)
// V = Vencida (hoy es posterior a SuscripcionFechaFin)
// F = Futura  (hoy es anterior a SuscripcionFechaInicio)
// C = Cancelada (decisión manual del usuario; no se calcula por fechas)
// S = Suspendida (decisión manual; no se calcula por fechas)
const ESTADOS = {
  ACTIVA: "A",
  VENCIDA: "V",
  FUTURA: "F",
  CANCELADA: "C",
  SUSPENDIDA: "S",
};

const { todayLocalISO } = require("./dateUtils");

function calcularEstadoPorFechas(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return ESTADOS.CANCELADA;
  const hoy = todayLocalISO();
  const ini = String(fechaInicio).split("T")[0];
  const fin = String(fechaFin).split("T")[0];
  if (hoy < ini) return ESTADOS.FUTURA;
  if (hoy > fin) return ESTADOS.VENCIDA;
  return ESTADOS.ACTIVA;
}

module.exports = { ESTADOS, calcularEstadoPorFechas };
