// Reglas de la corrección de caja: el caso más común del cliente es un cobro
// cargado como transferencia que era efectivo (o al revés). Estas reglas
// deciden cómo queda escrito el movimiento, cuánto efectivo se mueve en el
// cajón y quién puede corregir qué.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  clasificarMovimiento,
  destinoMedio,
  recalcularVentaTipo,
  deltaEfectivo,
  validarMotivo,
  dentroDePlazo,
  evaluarPermisoCorreccion,
  medioDeGrupo,
} = require("../utils/correccionCaja");
const { perteneceAlTurno } = require("../utils/turnoCaja");

describe("clasificarMovimiento", () => {
  const base = { TipoGastoId: 2, TipoGastoGrupoId: 1 };
  test("pago de suscripción", () => {
    assert.equal(clasificarMovimiento({ ...base, PagoId: 5 }), "PAGO");
  });
  test("venta y cobro de crédito", () => {
    assert.equal(
      clasificarMovimiento({ ...base, VentaId: 9, RegistroDiarioCajaDetalle: "Venta N°: 9" }),
      "VENTA"
    );
    assert.equal(
      clasificarMovimiento({
        ...base,
        TipoGastoGrupoId: 3,
        VentaId: 9,
        RegistroDiarioCajaDetalle: "Cobro Crédito Efectivo N°: 9",
      }),
      "COBRO_CREDITO"
    );
  });
  test("apertura, egresos y movimientos sin vínculo no se corrigen acá", () => {
    assert.equal(clasificarMovimiento({ TipoGastoId: 2, TipoGastoGrupoId: 2, VentaId: 1 }), null);
    assert.equal(clasificarMovimiento({ TipoGastoId: 1, TipoGastoGrupoId: 1, PagoId: 1 }), null);
    assert.equal(clasificarMovimiento({ ...base, RegistroDiarioCajaDetalle: "CO JUAN #3" }), null);
  });
});

describe("destinoMedio", () => {
  test("pago transferencia → efectivo usa el texto de pago.controller", () => {
    assert.deepEqual(destinoMedio("PAGO", "EFECTIVO", { suscripcionId: 1132 }), {
      grupoId: 1,
      pagoTipo: "CO",
      detalle: "Pago suscripción #1132 - Contado",
    });
    assert.equal(destinoMedio("PAGO", "TRANSFERENCIA", { suscripcionId: 7 }).grupoId, 6);
  });
  test("venta en efectivo: contado va al grupo 1, a cuenta al grupo 3", () => {
    assert.deepEqual(destinoMedio("VENTA", "EFECTIVO", { ventaId: 4, ventaTipo: "PO" }), {
      grupoId: 1,
      detalle: "Venta N°: 4",
    });
    assert.deepEqual(destinoMedio("VENTA", "EFECTIVO", { ventaId: 4, ventaTipo: "CR" }), {
      grupoId: 3,
      detalle: "Venta Crédito N°: 4",
    });
    assert.equal(destinoMedio("VENTA", "POS", { ventaId: 4 }).detalle, "Venta POS N°: 4");
  });
  test("cobro de crédito no admite voucher; medio desconocido da error", () => {
    assert.ok(destinoMedio("COBRO_CREDITO", "VOUCHER", { ventaId: 1 }).error);
    assert.ok(destinoMedio("PAGO", "CHEQUE", {}).error);
  });
  test("ida y vuelta con medioDeGrupo", () => {
    for (const m of ["EFECTIVO", "POS", "VOUCHER", "TRANSFERENCIA"]) {
      assert.equal(medioDeGrupo(destinoMedio("PAGO", m, { suscripcionId: 1 }).grupoId), m);
    }
  });
});

describe("recalcularVentaTipo", () => {
  test("misma prioridad que confirmar", () => {
    assert.equal(recalcularVentaTipo("CO", [1, 6]), "TR");
    assert.equal(recalcularVentaTipo("TR", [1, 4]), "PO");
    assert.equal(recalcularVentaTipo("PO", [1]), "CO");
    assert.equal(recalcularVentaTipo("CO", [5]), "CO");
  });
  test("una venta a cuenta sigue siendo a cuenta", () => {
    assert.equal(recalcularVentaTipo("CR", [6]), "CR");
  });
});

describe("deltaEfectivo", () => {
  test("transferencia → efectivo entra al cajón, y al revés sale", () => {
    assert.equal(deltaEfectivo(150000, 6, 1), 150000);
    assert.equal(deltaEfectivo(150000, 1, 6), -150000);
  });
  test("entre medios no efectivo no mueve el cajón", () => {
    assert.equal(deltaEfectivo(1000, 4, 6), 0);
    assert.equal(deltaEfectivo(1000, 1, 3), 0);
  });
});

describe("validarMotivo", () => {
  test("obligatorio y acotado", () => {
    assert.ok(validarMotivo("").error);
    assert.ok(validarMotivo("   ab ").error);
    assert.ok(validarMotivo("x".repeat(251)).error);
    assert.deepEqual(validarMotivo("  Era efectivo  "), { motivo: "Era efectivo" });
  });
});

describe("dentroDePlazo", () => {
  test("cuenta días calendario desde el cierre", () => {
    assert.equal(dentroDePlazo(new Date(2026, 10, 11, 22, 0), "2026-11-18", 7), true);
    assert.equal(dentroDePlazo(new Date(2026, 10, 10, 22, 0), "2026-11-18", 7), false);
    assert.equal(dentroDePlazo(new Date(2026, 10, 17, 21, 0), "2026-11-18", 1), true);
  });
});

describe("perteneceAlTurno", () => {
  test("por rango de ids cuando no hay AperturaRef", () => {
    assert.equal(perteneceAlTurno({ RegistroDiarioCajaId: 15 }, 10, 20), true);
    assert.equal(perteneceAlTurno({ RegistroDiarioCajaId: 25 }, 10, 20), false);
    assert.equal(perteneceAlTurno({ RegistroDiarioCajaId: 25 }, 10, null), true);
  });
  test("AperturaRef manda: el movimiento es de ese turno y de ningún otro", () => {
    assert.equal(perteneceAlTurno({ RegistroDiarioCajaId: 99, AperturaRef: 10 }, 10, 20), true);
    // Cargado en el turno de ayer: no cuenta en el turno abierto de hoy.
    assert.equal(perteneceAlTurno({ RegistroDiarioCajaId: 99, AperturaRef: 10 }, 50, null), false);
  });
});

describe("evaluarPermisoCorreccion", () => {
  const cerrado = {
    aperturaId: 10,
    cierreId: 20,
    abierto: false,
    usuarioId: "ana",
    cierreFecha: new Date(2026, 10, 17, 21, 0),
  };
  const abierto = { aperturaId: 30, cierreId: null, abierto: true, usuarioId: "ana" };
  const ctx = { hoyISO: "2026-11-18", plazoDias: 7 };

  test("turno cerrado: sólo supervisor y dentro del plazo", () => {
    assert.equal(
      evaluarPermisoCorreccion({ ...ctx, turno: cerrado, usuarioId: "sup", esSupervisor: true }).ok,
      true
    );
    const cajera = evaluarPermisoCorreccion({
      ...ctx,
      turno: cerrado,
      usuarioId: "ana",
      esSupervisor: false,
      puedeEditarPropio: true,
    });
    assert.equal(cajera.ok, false);
    assert.equal(cajera.status, 403);
    const viejo = evaluarPermisoCorreccion({
      ...ctx,
      turno: { ...cerrado, cierreFecha: new Date(2026, 9, 1) },
      esSupervisor: true,
    });
    assert.equal(viejo.status, 409);
  });

  test("turno abierto: el dueño con permiso de editar, o el supervisor", () => {
    assert.equal(
      evaluarPermisoCorreccion({ ...ctx, turno: abierto, usuarioId: "ana", puedeEditarPropio: true }).ok,
      true
    );
    assert.equal(
      evaluarPermisoCorreccion({ ...ctx, turno: abierto, usuarioId: "beto", puedeEditarPropio: true }).ok,
      false
    );
    assert.equal(
      evaluarPermisoCorreccion({ ...ctx, turno: abierto, usuarioId: "sup", esSupervisor: true }).ok,
      true
    );
  });

  test("movimiento fuera de turno no se corrige acá", () => {
    const r = evaluarPermisoCorreccion({
      ...ctx,
      turno: { ...cerrado, fueraDeTurno: true },
      esSupervisor: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });
});
