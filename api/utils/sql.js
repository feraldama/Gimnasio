// Escapa los caracteres especiales de LIKE en MySQL (% _ \).
// Usar antes de envolver con %...% en búsquedas tipo "contiene".
// Ejemplo: buscar "50%" → no debe devolver todo lo que tiene "50" y cualquier cosa después.
function escapeLike(value) {
  if (value == null) return "";
  return String(value).replace(/[\\%_]/g, "\\$&");
}

module.exports = { escapeLike };
