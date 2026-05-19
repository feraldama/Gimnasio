// Cálculo del dígito verificador (DV) del RUC en Paraguay según el algoritmo
// módulo 11 publicado por la SET (Subsecretaría de Estado de Tributación).
//
// Reglas:
//   - Se recorre el número de derecha a izquierda.
//   - Cada dígito se multiplica por un peso que arranca en 2 y crece hasta
//     11; al llegar a 12 vuelve a 2.
//   - Letras (RUC con caracteres alfabéticos en personas jurídicas) se
//     reemplazan por su valor ASCII antes de multiplicar.
//   - Se suman los productos. resto = suma % 11.
//   - Si resto > 1  → DV = 11 - resto
//   - Si resto <= 1 → DV = 0

function calcularDV(numero) {
  if (numero == null) return 0;
  const limpio = String(numero).toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!limpio) return 0;

  // Expandir letras a su codigo ASCII (como hace la SET para RUCs con letras).
  let normalizado = "";
  for (const ch of limpio) {
    const c = ch.charCodeAt(0);
    if (c < 48 || c > 57) {
      normalizado += c.toString();
    } else {
      normalizado += ch;
    }
  }

  let total = 0;
  let k = 2;
  for (let i = normalizado.length - 1; i >= 0; i--) {
    if (k > 11) k = 2;
    total += parseInt(normalizado[i], 10) * k;
    k++;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

// Formatea como "12345678-9". Si no hay ruc devuelve cadena vacia.
function formatearRUC(ruc, dv) {
  if (!ruc) return "";
  const dvStr = dv === null || dv === undefined || dv === "" ? "" : `-${dv}`;
  return `${ruc}${dvStr}`;
}

module.exports = { calcularDV, formatearRUC };
