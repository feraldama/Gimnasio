// Ticket de cierre reimpreso: el sobrante/faltante "original" (el que vio el
// cajero esa noche) se reconstruye deshaciendo las correcciones posteriores al
// cierre sobre el efectivo esperado.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  ajustePorCorreccionesPosteriores,
  efectoEnEsperado,
  esperadoDelTurno,
  diferenciaAlCerrar,
} = require("../utils/ticketCierre");

const turno = { aperturaId: 100, cierreId: 120 };
const mov = (id, grupo, monto, extra = {}) => ({
  RegistroDiarioCajaId: id,
  TipoGastoId: 2,
  TipoGastoGrupoId: grupo,
  RegistroDiarioCajaMonto: monto,
  AperturaRef: null,
  ...extra,
});

describe("efectoEnEsperado", () => {
  test("ingresos en efectivo suman, POS/voucher/transfer no", () => {
    assert.equal(efectoEnEsperado(2, 1, 1000), 1000);
    assert.equal(efectoEnEsperado(2, 3, 1000), 1000);
    for (const g of [4, 5, 6]) assert.equal(efectoEnEsperado(2, g, 1000), 0);
  });
  test("egresos restan, apertura/cierre no cuentan", () => {
    assert.equal(efectoEnEsperado(1, 7, 500), -500);
    assert.equal(efectoEnEsperado(1, 2, 500), 0);
    assert.equal(efectoEnEsperado(2, 2, 500), 0);
  });
});

describe("ajustePorCorreccionesPosteriores", () => {
  test("sin correcciones no hay ajuste", () => {
    assert.deepEqual(ajustePorCorreccionesPosteriores([], [], turno), { ajuste: 0, cantidad: 0 });
  });

  test("las correcciones con el turno abierto no cuentan", () => {
    const c = {
      CierreId: null,
      CorreccionCajaAccion: "METODO",
      CorreccionCajaAntes: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 6, RegistroDiarioCajaMonto: 150000 },
      CorreccionCajaDespues: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 1 },
    };
    assert.deepEqual(ajustePorCorreccionesPosteriores([c], [], turno), { ajuste: 0, cantidad: 0 });
  });

  test("transferencia → efectivo sube el esperado", () => {
    const c = {
      CierreId: 120,
      CorreccionCajaAccion: "METODO",
      CorreccionCajaAntes: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 6, RegistroDiarioCajaMonto: 150000 },
      CorreccionCajaDespues: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 1 },
    };
    const r = ajustePorCorreccionesPosteriores([c], [mov(105, 1, 150000)], turno);
    assert.deepEqual(r, { ajuste: 150000, cantidad: 1 });
  });

  test("acepta antes/despues como texto JSON", () => {
    const c = {
      CierreId: 120,
      CorreccionCajaAccion: "METODO",
      CorreccionCajaAntes: JSON.stringify({ RegistroDiarioCajaId: 105, TipoGastoGrupoId: 1, RegistroDiarioCajaMonto: 20000 }),
      CorreccionCajaDespues: JSON.stringify({ RegistroDiarioCajaId: 105, TipoGastoGrupoId: 4 }),
    };
    assert.equal(ajustePorCorreccionesPosteriores([c], [], turno).ajuste, -20000);
  });

  test("anular venta en efectivo baja el esperado (sólo lo del turno)", () => {
    const c = {
      CierreId: 120,
      CorreccionCajaAccion: "ANULAR",
      CorreccionCajaAntes: {
        movimientos: [mov(110, 1, 15000), mov(110, 4, 5000), mov(300, 3, 9000)],
      },
    };
    assert.equal(ajustePorCorreccionesPosteriores([c], [], turno).ajuste, -15000);
  });

  test("cargar venta faltante sube el esperado", () => {
    const c = { CierreId: 120, CorreccionCajaAccion: "CARGAR", CorreccionCajaEntidadId: 77 };
    const regs = [mov(500, 1, 12000, { AperturaRef: 100, VentaId: 77 }), mov(501, 6, 3000, { AperturaRef: 100, VentaId: 77 })];
    assert.equal(ajustePorCorreccionesPosteriores([c], regs, turno).ajuste, 12000);
  });

  test("cargar y después anular la misma venta: sin ajuste", () => {
    const cargar = { CierreId: 120, CorreccionCajaAccion: "CARGAR", CorreccionCajaEntidadId: 77 };
    const anular = {
      CierreId: 120,
      CorreccionCajaAccion: "ANULAR",
      CorreccionCajaAntes: { movimientos: [mov(500, 1, 12000, { AperturaRef: 100, VentaId: 77 })] },
    };
    const r = ajustePorCorreccionesPosteriores([cargar, anular], [], turno);
    assert.deepEqual(r, { ajuste: 0, cantidad: 2 });
  });

  test("cambiar medio y después anular: queda el efecto del medio original", () => {
    const metodo = {
      CierreId: 120,
      CorreccionCajaAccion: "METODO",
      CorreccionCajaAntes: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 6, RegistroDiarioCajaMonto: 8000 },
      CorreccionCajaDespues: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 1 },
    };
    const anular = {
      CierreId: 120,
      CorreccionCajaAccion: "ANULAR",
      CorreccionCajaAntes: { movimientos: [mov(105, 1, 8000)] },
    };
    // Original: transferencia (0 en efectivo). Actual: no existe (0). Ajuste 0.
    assert.equal(ajustePorCorreccionesPosteriores([metodo, anular], [], turno).ajuste, 0);
  });

  test("cambiar medio de una venta cargada después del cierre no cuenta", () => {
    const metodo = {
      CierreId: 120,
      CorreccionCajaAccion: "METODO",
      CorreccionCajaAntes: { RegistroDiarioCajaId: 500, TipoGastoGrupoId: 1, RegistroDiarioCajaMonto: 12000 },
      CorreccionCajaDespues: { RegistroDiarioCajaId: 500, TipoGastoGrupoId: 6 },
    };
    const cargar = { CierreId: 120, CorreccionCajaAccion: "CARGAR", CorreccionCajaEntidadId: 77 };
    const regs = [mov(500, 6, 12000, { AperturaRef: 100, VentaId: 77 })];
    assert.equal(ajustePorCorreccionesPosteriores([cargar, metodo], regs, turno).ajuste, 0);
  });
});

describe("esperadoDelTurno", () => {
  test("apertura + efectivo − egresos; apertura/cierre y POS no suman", () => {
    const regs = [
      { RegistroDiarioCajaId: 100, TipoGastoId: 2, TipoGastoGrupoId: 2, RegistroDiarioCajaMonto: 100000 },
      mov(101, 1, 50000),
      mov(102, 4, 30000),
      { RegistroDiarioCajaId: 103, TipoGastoId: 1, TipoGastoGrupoId: 7, RegistroDiarioCajaMonto: 10000 },
      { RegistroDiarioCajaId: 120, TipoGastoId: 1, TipoGastoGrupoId: 2, RegistroDiarioCajaMonto: 140000 },
    ];
    assert.equal(esperadoDelTurno(regs, 100000), 140000);
  });
});

describe("diferenciaAlCerrar", () => {
  const apertura = { RegistroDiarioCajaMonto: 0 };
  test("usa la guardada al cerrar aunque después haya cambios", () => {
    const cierre = { RegistroDiarioCajaMonto: 100000, DiferenciaCierre: -25000 };
    const r = diferenciaAlCerrar({ cierre, apertura, registros: [mov(101, 1, 999999)], correcciones: [], turno });
    assert.equal(r, -25000);
  });
  test("cierre viejo: reconstruye deshaciendo las correcciones", () => {
    // Esa noche: 150.000 por transferencia, declaró 150.000 en efectivo →
    // sobrante 150.000. Hoy el cobro está corregido a efectivo → cuadra.
    const cierre = { RegistroDiarioCajaMonto: 150000, DiferenciaCierre: null };
    const c = {
      CierreId: 120,
      CorreccionCajaAccion: "METODO",
      CorreccionCajaAntes: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 6, RegistroDiarioCajaMonto: 150000 },
      CorreccionCajaDespues: { RegistroDiarioCajaId: 105, TipoGastoGrupoId: 1 },
    };
    const r = diferenciaAlCerrar({ cierre, apertura, registros: [mov(105, 1, 150000)], correcciones: [c], turno });
    assert.equal(r, -150000);
  });
});

describe("correcciones desde Registro Diario Caja", () => {
  const egreso = (monto) => ({ RegistroDiarioCajaId: 110, TipoGastoId: 1, TipoGastoGrupoId: 7, RegistroDiarioCajaMonto: monto, AperturaRef: null });
  test("borrar un egreso de 10.000 sube el esperado actual", () => {
    const c = { CierreId: 120, CorreccionCajaEntidad: "REGISTRO", CorreccionCajaAccion: "ELIMINAR", CorreccionCajaAntes: egreso(10000) };
    assert.equal(ajustePorCorreccionesPosteriores([c], [], turno).ajuste, 10000);
  });
  test("editar un egreso de 10.000 a 4.000", () => {
    const c = { CierreId: 120, CorreccionCajaEntidad: "REGISTRO", CorreccionCajaAccion: "EDITAR", CorreccionCajaAntes: egreso(10000), CorreccionCajaDespues: egreso(4000) };
    assert.equal(ajustePorCorreccionesPosteriores([c], [], turno).ajuste, 6000);
  });
  test("cierre viejo con el monto declarado corregido: vale el declarado original", () => {
    const cierre = { RegistroDiarioCajaId: 120, TipoGastoId: 1, TipoGastoGrupoId: 2, RegistroDiarioCajaMonto: 90000, DiferenciaCierre: null };
    const c = {
      CierreId: 120,
      CorreccionCajaEntidad: "REGISTRO",
      CorreccionCajaAccion: "EDITAR",
      CorreccionCajaEntidadId: 120,
      CorreccionCajaAntes: { ...cierre, RegistroDiarioCajaMonto: 100000 },
      CorreccionCajaDespues: cierre,
    };
    const apertura = { RegistroDiarioCajaId: 100, RegistroDiarioCajaMonto: 0 };
    // Esperado 90.000; esa noche declaró 100.000 → sobrante 10.000.
    const r = diferenciaAlCerrar({ cierre, apertura, registros: [mov(101, 1, 90000)], correcciones: [c], turno });
    assert.equal(r, -10000);
  });
});
