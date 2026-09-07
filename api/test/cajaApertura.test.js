// Regla de apertura y cierre de caja. Es la que evita que se abra una caja ya
// abierta (el monto de apertura se sumaría dos veces) o que se cierre una caja
// cerrada (se volvería a poner en cero un cajón ya cuadrado).
//
// El estado no vive en una columna: se deduce comparando los ids de la última
// apertura y el último cierre en `registrodiariocaja`. Por eso los casos se
// expresan con pares de ids.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluarAperturaCierre,
  esSolicitudDeApertura,
  TIPO_GASTO_APERTURA,
  TIPO_GASTO_CIERRE,
  TIPO_GASTO_GRUPO_CAJA,
} = require("../utils/cajaApertura");

const abrir = (aperturaId, cierreId) =>
  evaluarAperturaCierre({ esApertura: true, aperturaId, cierreId });
const cerrar = (aperturaId, cierreId) =>
  evaluarAperturaCierre({ esApertura: false, aperturaId, cierreId });

describe("apertura de caja", () => {
  test("caja nueva, sin historial -> permitida", () => {
    assert.equal(abrir(0, 0).permitido, true);
  });

  test("último movimiento fue un cierre -> permitida", () => {
    assert.equal(abrir(5, 8).permitido, true);
  });

  test("caja ya abierta -> rechazada, y avisa que hay que cerrar", () => {
    // Si se permitiera, el monto de apertura se sumaría de nuevo al cajón.
    const r = abrir(8, 5);
    assert.equal(r.permitido, false);
    assert.match(r.error, /CAJA ABIERTA/);
  });

  test("apertura y cierre con el mismo id -> se considera abierta", () => {
    // No debería pasar en la práctica (ids distintos por fila), pero el
    // desempate tiene que ser conservador: no volver a abrir.
    assert.equal(abrir(5, 5).permitido, false);
  });

  test("hay cierres pero ninguna apertura -> permitida", () => {
    // Base migrada a mano o datos importados: no debe trabar la operación.
    assert.equal(abrir(0, 7).permitido, true);
  });
});

describe("cierre de caja", () => {
  test("caja abierta -> permitido", () => {
    assert.equal(cerrar(8, 5).permitido, true);
  });

  test("caja ya cerrada -> rechazado, y avisa que hay que abrir", () => {
    // Si se permitiera, pondría en cero un cajón ya cuadrado y quedaría un
    // segundo registro de cierre sin apertura que le corresponda.
    const r = cerrar(5, 8);
    assert.equal(r.permitido, false);
    assert.match(r.error, /CAJA CERRADA/);
  });

  test("caja nueva, sin historial -> rechazado", () => {
    assert.equal(cerrar(0, 0).permitido, false);
  });

  test("apertura y cierre con el mismo id -> rechazado", () => {
    assert.equal(cerrar(5, 5).permitido, false);
  });
});

describe("ciclo completo", () => {
  test("abrir, cerrar, abrir de nuevo", () => {
    // Simula la secuencia de ids que van quedando en la tabla.
    let apertura = 0;
    let cierre = 0;
    let siguienteId = 1;

    assert.equal(abrir(apertura, cierre).permitido, true);
    apertura = siguienteId++;

    assert.equal(abrir(apertura, cierre).permitido, false, "no reabrir");
    assert.equal(cerrar(apertura, cierre).permitido, true);
    cierre = siguienteId++;

    assert.equal(cerrar(apertura, cierre).permitido, false, "no recerrar");
    assert.equal(abrir(apertura, cierre).permitido, true, "nuevo turno");
  });

  test("en todo estado alcanzable hay exactamente una operación disponible", () => {
    // Propiedad: nunca se puede abrir Y cerrar a la vez (sería ambiguo y el
    // cajón se descuadraría), ni quedar sin ninguna opción (la caja quedaría
    // trabada).
    //
    // Se excluye a === c con valores distintos de cero porque es inalcanzable:
    // apertura y cierre son filas distintas de `registrodiariocaja` y los ids
    // salen de una única secuencia, así que jamás coinciden. El único empate
    // real es 0 y 0 (caja sin historial), que sí se prueba.
    for (let a = 0; a <= 6; a++) {
      for (let c = 0; c <= 6; c++) {
        if (a === c && a !== 0) continue;
        const puedeAbrir = abrir(a, c).permitido;
        const puedeCerrar = cerrar(a, c).permitido;
        assert.notEqual(
          puedeAbrir,
          puedeCerrar,
          `estado inconsistente con apertura=${a} cierre=${c}`
        );
      }
    }
  });

  test("ids iguales y no nulos: estado inalcanzable, queda trabado", () => {
    // Documenta el comportamiento en un estado que la base no puede producir.
    // Si algún día se cargaran registros a mano con ids pisados, la caja no
    // permitiría ni abrir ni cerrar y habría que corregir los datos.
    assert.equal(abrir(4, 4).permitido, false);
    assert.equal(cerrar(4, 4).permitido, false);
  });
});

describe("entradas raras", () => {
  test("ids como string se tratan como números", () => {
    // El id viaja desde la base y el adaptador podría entregarlo como texto.
    assert.equal(abrir("0", "0").permitido, true);
    assert.equal(cerrar("8", "5").permitido, true);
  });

  test("null y undefined cuentan como 'no hubo' (0)", () => {
    assert.equal(abrir(null, undefined).permitido, true);
    assert.equal(cerrar(null, null).permitido, false);
  });
});

describe("esSolicitudDeApertura", () => {
  test("el flag 0 significa APERTURA (convención heredada)", () => {
    // El nombre `apertura` invita a leerlo al revés: vale 0 para abrir.
    assert.equal(esSolicitudDeApertura(0), true);
    assert.equal(esSolicitudDeApertura("0"), true);
  });

  test("cualquier otro valor significa CIERRE", () => {
    assert.equal(esSolicitudDeApertura(1), false);
    assert.equal(esSolicitudDeApertura("1"), false);
    assert.equal(esSolicitudDeApertura(2), false);
  });
});

describe("códigos de tipo de gasto", () => {
  test("apertura y cierre usan códigos distintos del mismo grupo", () => {
    // Las consultas getUltimaApertura/getUltimoCierre filtran por estos
    // valores; si coincidieran, el estado de la caja sería indistinguible.
    assert.notEqual(TIPO_GASTO_APERTURA, TIPO_GASTO_CIERRE);
    assert.equal(TIPO_GASTO_APERTURA, 2);
    assert.equal(TIPO_GASTO_CIERRE, 1);
    assert.equal(TIPO_GASTO_GRUPO_CAJA, 2);
  });
});
