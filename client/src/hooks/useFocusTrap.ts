import { useEffect, type RefObject } from "react";

// Selector de elementos enfocables dentro de un diálogo.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Atrapa el foco del teclado dentro de un contenedor mientras está activo
 * (típicamente un modal/diálogo). Hace tres cosas:
 *   1. Al activarse, mueve el foco al primer elemento enfocable (o al contenedor).
 *   2. Cicla Tab / Shift+Tab dentro del contenedor (no se escapa al fondo).
 *   3. Al desactivarse o desmontarse, devuelve el foco al elemento que lo tenía
 *      antes de abrir el modal.
 *
 * El contenedor debe tener `tabIndex={-1}` para poder recibir foco como fallback.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options: { autoFocus?: boolean } = {}
) {
  const { autoFocus = true } = options;
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Foco inicial dentro del diálogo (salvo que el componente lo maneje él mismo).
    if (autoFocus) {
      const initial = getFocusables();
      if (initial.length > 0) initial[0].focus();
      else container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // El listener está en el contenedor: solo dispara cuando el foco está
      // dentro. Frenamos la propagación para que, con modales anidados, el trap
      // MÁS INTERNO sea el único que maneje el Tab (su listener corre antes que
      // el del contenedor padre en la fase de burbujeo).
      e.stopPropagation();
      const items = getFocusables();
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Devolver el foco al disparador (si sigue en el DOM).
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef, autoFocus]);
}
