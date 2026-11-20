// Helpers de fecha en zona horaria local del servidor.
// `new Date().toISOString()` siempre devuelve UTC; en GMT-3 eso adelanta el día
// entre 21:00 y 23:59 locales. Estas funciones usan getters locales.

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysLocal(yyyymmdd, days) {
  if (!yyyymmdd) return "";
  const datePart = String(yyyymmdd).split("T")[0];
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return "";
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toLocalISODate(date);
}

/** "YYYY-MM-DD HH:MM:SS" en hora local (para columnas TIMESTAMP sin zona). */
function toLocalSQLDateTime(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${toLocalISODate(date)} ${hh}:${mi}:${ss}`;
}

module.exports = {
  todayLocalISO,
  toLocalISODate,
  addDaysLocal,
  toLocalSQLDateTime,
};
