// Cálculo del dígito verificador (DV) del RUC en Paraguay — módulo 11 SET.
// Mirror del helper backend (api/utils/rucDv.js) para mostrar el DV en vivo
// en los formularios. El cálculo autoritativo lo hace el backend al guardar.

export function calcularDV(numero: string | number | null | undefined): number {
  if (numero == null) return 0;
  const limpio = String(numero).toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!limpio) return 0;

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

// Devuelve "CI-DV" listo para mostrar/imprimir. Si la CI no es estrictamente
// numérica (placeholders tipo "SIN RUC") devuelve la CI sin DV.
export function formatearRUC(
  ruc: string | number | null | undefined,
  dv?: string | number | null
): string {
  const ci = String(ruc ?? "").trim();
  if (!ci) return "";
  // Si nos pasaron un DV explícito, lo usamos. Sino lo calculamos si la CI
  // es numérica.
  if (dv !== undefined && dv !== null && dv !== "") {
    return `${ci}-${dv}`;
  }
  if (!/^\d+$/.test(ci)) return ci;
  return `${ci}-${calcularDV(ci)}`;
}
