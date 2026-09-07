// Tablero mensual contra la base: verifica que cada línea de negocio sume lo
// que corresponde y, sobre todo, que las exclusiones se respeten.
//
// Es el test que faltaba: la aritmética pura ya estaba cubierta en
// test/tablero.test.js, pero las consultas SQL — de dónde sale cada cifra y
// qué se excluye — sólo se habían validado con un script descartable. Acá
// quedan fijadas.
//
// Los casos que más importan son los negativos: que la APERTURA DE CAJA no
// cuente como ingreso, que el CIERRE DE CAJA no cuente como gasto, y que una
// ANULACION de cobro de cancha se netee del ingreso en lugar de aparecer como
// egreso (que es lo que hacía antes de la migración 019, etiquetada como
// LAVADERO).
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
//
// Apuntar DB_NAME a una copia, no a la base de producción del gimnasio.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

// Mes fijo en el futuro para no chocar con datos reales del gimnasio.
const ANIO = 2099;
const MES = 6;
const F = (d) => `${ANIO}-06-${String(d).padStart(2, "0")}`;
const FANT = (d) => `${ANIO}-05-${String(d).padStart(2, "0")}`;

describe(
  "tablero mensual",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, ctrl;
    let usuarioId;
    const ids = { cliente: null, plan: null, caja: null, cancha: null, venta: null };

    const q = (sql, params) =>
      new Promise((res, rej) =>
        db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r)))
      );

    // Invoca el controlador directamente y devuelve el JSON de la respuesta,
    // sin levantar el servidor HTTP.
    const pedirTablero = (anio = ANIO, mes = MES) =>
      new Promise((resolve, reject) => {
        const req = { query: { anio: String(anio), mes: String(mes) } };
        const res = {
          json: resolve,
          status: (code) => ({
            json: (body) =>
              reject(new Error(`el endpoint respondió ${code}: ${JSON.stringify(body)}`)),
          }),
        };
        ctrl.tableroMensual(req, res).catch(reject);
      });

    const mov = (fecha, tipo, grupo, detalle, monto) =>
      q(
        `INSERT INTO registrodiariocaja (CajaId, RegistroDiarioCajaFecha, TipoGastoId,
            TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ids.caja, fecha, tipo, grupo, detalle, monto, usuarioId]
      );

    before(async () => {
      db = require("../../config/db");
      ctrl = require("../../controllers/tablero.controller");

      const u = await q("SELECT UsuarioId FROM usuario LIMIT 1");
      assert.ok(u.length, "la base necesita al menos un usuario");
      usuarioId = u[0].UsuarioId;

      const cli = await q(
        `INSERT INTO clientes (ClienteRUC, ClienteNombre, ClienteTipo)
         VALUES ('', 'TEST-TABLERO', 'MI')`
      );
      ids.cliente = cli.insertId;
      const plan = await q(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanActivo, PlanModalidad)
         VALUES ('TEST-TABLERO', 30, 0, 1, 'MENSUAL')`
      );
      ids.plan = plan.insertId;
      const caja = await q(
        `INSERT INTO caja (CajaDescripcion, CajaMonto) VALUES ('TEST-TABLERO', 0)`
      );
      ids.caja = caja.insertId;
      const cancha = await q(
        `INSERT INTO cancha (CanchaNombre, CanchaTarifaHora, CanchaActiva)
         VALUES ('TEST-TABLERO', 0, 1)`
      );
      ids.cancha = cancha.insertId;

      // --- GIMNASIO: 300.000 este mes, 100.000 el anterior ---
      const sus = await q(
        `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio,
            SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes)
         VALUES (?, ?, ?, ?, 'A', 0)`,
        [ids.cliente, ids.plan, F(1), F(30)]
      );
      ids.suscripcion = sus.insertId;
      for (const [monto, fecha] of [
        [200000, F(5)],
        [100000, F(12)],
        [100000, FANT(10)],
      ]) {
        await q(
          `INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId)
           VALUES (?, ?, 'CO', ?, ?)`,
          [ids.suscripcion, monto, fecha, usuarioId]
        );
      }

      // --- CANTINA: venta de 500.000 el día 8 con 300.000 cobrados en el
      //     acto, y 50.000 de esa cuenta cobrados el día 20.
      //
      //     `VentaEntrega` se carga en 350.000 a propósito: es un ACUMULADO,
      //     y así lo deja el sistema real (ventacreditopago.controller hace
      //     `VentaEntrega = VentaEntrega + monto` al cobrar). El fixture tiene
      //     que reproducir ese estado o el test no detecta el doble conteo.
      //
      //     Esperado: cobro inicial 300.000 en el mes de la venta y 50.000 en
      //     el mes del cobro. Total cantina del mes = 350.000, no 400.000.
      const maxV = (await q("SELECT COALESCE(MAX(VentaId),0) AS m FROM venta"))[0].m;
      ids.venta = Number(maxV) + 1;
      await q(
        `INSERT INTO venta (VentaId, VentaFecha, ClienteId, AlmacenId, VentaTipo,
            VentaPagoTipo, VentaCantidadProductos, VentaUsuario, VentaNroFactura,
            VentaTimbrado, Total, VentaEntrega, VentaNroPOS)
         VALUES (?, ?, ?, 1, 'CR', 'C', 1, ?, 0, 0, 500000, 350000, 0)`,
        [ids.venta, F(8), ids.cliente, usuarioId]
      );
      // `ventacreditopago` tiene FK a `ventacredito`: hay que crear el
      // encabezado del crédito antes de la cuota.
      await q(
        `INSERT INTO ventacredito (VentaCreditoId, VentaId, VentaCreditoPagoCant)
         VALUES (?, ?, 1)`,
        [ids.venta, ids.venta]
      );
      await q(
        `INSERT INTO ventacreditopago (VentaCreditoId, VentaCreditoPagoId,
            VentaCreditoPagoFecha, VentaCreditoPagoMonto)
         VALUES (?, 1, ?, 50000)`,
        [ids.venta, F(20)]
      );

      // --- CANCHA: reserva pagada por 400.000 de la cual 150.000 quedaron a
      //     crédito. Neto esperado: 250.000. ---
      const maxC = (
        await q("SELECT COALESCE(MAX(CanchaCreditoId),0) AS m FROM cancha_credito")
      )[0].m;
      ids.credito = Number(maxC) + 1;
      const reserva = await q(
        `INSERT INTO cancha_reserva (CanchaId, CanchaReservaCliente, CanchaReservaFecha,
            CanchaReservaHoraInicio, CanchaReservaHoraFin, CanchaReservaMonto,
            CanchaReservaEstado, ClienteId)
         VALUES (?, 'TEST', ?, ?, ?, 400000, 'P', ?)`,
        [ids.cancha, F(9), `${F(9)} 10:00`, `${F(9)} 11:00`, ids.cliente]
      );
      ids.reserva = reserva.insertId;
      await q(
        `INSERT INTO cancha_credito (CanchaCreditoId, CanchaReservaId, ClienteId,
            CanchaCreditoMonto, CanchaCreditoSaldo, CanchaCreditoFecha, CanchaCreditoPagoCant)
         VALUES (?, ?, ?, 150000, 150000, ?, 0)`,
        [ids.credito, ids.reserva, ids.cliente, F(9)]
      );

      // --- EGRESOS: COMPRA 600.000 + COMBUSTIBLE 80.000 este mes,
      //     COMPRA 400.000 el anterior. Más apertura y cierre, que NO cuentan.
      await mov(F(3), 1, 1, "TEST compra", 600000);
      await mov(F(15), 1, 4, "TEST combustible", 80000);
      await mov(F(1), 2, 2, "TEST apertura", 999999);
      await mov(F(28), 1, 2, "TEST cierre", 888888);
      await mov(FANT(4), 1, 1, "TEST compra ant", 400000);
    });

    after(async () => {
      if (!db) return;
      try {
        if (ids.credito)
          await q("DELETE FROM cancha_credito WHERE CanchaCreditoId = ?", [ids.credito]);
        if (ids.cancha) {
          await q("DELETE FROM cancha_reserva WHERE CanchaId = ?", [ids.cancha]);
          await q("DELETE FROM cancha WHERE CanchaId = ?", [ids.cancha]);
        }
        if (ids.venta) {
          await q("DELETE FROM ventacreditopago WHERE VentaCreditoId = ?", [ids.venta]);
          await q("DELETE FROM ventacredito WHERE VentaCreditoId = ?", [ids.venta]);
          await q("DELETE FROM venta WHERE VentaId = ?", [ids.venta]);
        }
        if (ids.cliente) {
          await q(
            "DELETE FROM pago WHERE SuscripcionId IN (SELECT SuscripcionId FROM suscripcion WHERE ClienteId = ?)",
            [ids.cliente]
          );
          await q("DELETE FROM suscripcion WHERE ClienteId = ?", [ids.cliente]);
        }
        if (ids.caja) {
          await q("DELETE FROM registrodiariocaja WHERE CajaId = ?", [ids.caja]);
          await q("DELETE FROM caja WHERE CajaId = ?", [ids.caja]);
        }
        if (ids.plan) await q("DELETE FROM plan WHERE PlanId = ?", [ids.plan]);
        if (ids.cliente)
          await q("DELETE FROM clientes WHERE ClienteId = ?", [ids.cliente]);
      } finally {
        await db.end();
      }
    });

    const linea = (t, clave) => t.lineas.find((l) => l.clave === clave);
    const cat = (t, nombre) =>
      t.egresos.porCategoria.find((c) => c.categoria === nombre);

    test("gimnasio suma los pagos del mes, no los del anterior", async () => {
      const t = await pedirTablero();
      assert.equal(linea(t, "GIMNASIO").monto, 300000);
      assert.equal(linea(t, "GIMNASIO").mesAnterior, 100000);
      assert.equal(linea(t, "GIMNASIO").variacionPct, 200);
    });

    test("cantina suma el cobro inicial más los cobros de crédito", async () => {
      // VentaEntrega vale 350.000 (acumulado) y hay 50.000 en
      // ventacreditopago. El cobro inicial fue 300.000, así que el mes suma
      // 300.000 + 50.000 = 350.000. Si se sumara VentaEntrega crudo daría
      // 400.000: el cobro de crédito contado dos veces.
      const t = await pedirTablero();
      assert.equal(linea(t, "CANTINA").monto, 350000);
    });

    test("un cobro de crédito no se cuenta dos veces ni infla el mes de la venta", async () => {
      // Se agrega un segundo cobro de 100.000 en el mes SIGUIENTE, replicando
      // lo que hace el sistema: inserta la cuota y acumula en VentaEntrega.
      await q(
        `INSERT INTO ventacreditopago (VentaCreditoId, VentaCreditoPagoId,
            VentaCreditoPagoFecha, VentaCreditoPagoMonto)
         VALUES (?, 2, ?, 100000)`,
        [ids.venta, `${ANIO}-07-05`]
      );
      await q(
        "UPDATE venta SET VentaEntrega = VentaEntrega + 100000 WHERE VentaId = ?",
        [ids.venta]
      );
      try {
        // El mes de la venta NO debe moverse: el cobro nuevo es de julio.
        const t = await pedirTablero();
        assert.equal(
          linea(t, "CANTINA").monto,
          350000,
          "cobrar una cuenta vieja no debe cambiar el mes de la venta"
        );
        // Y julio debe mostrar exactamente el cobro nuevo.
        const julio = await pedirTablero(ANIO, 7);
        assert.equal(linea(julio, "CANTINA").monto, 100000);
      } finally {
        await q(
          "DELETE FROM ventacreditopago WHERE VentaCreditoId = ? AND VentaCreditoPagoId = 2",
          [ids.venta]
        );
        await q(
          "UPDATE venta SET VentaEntrega = VentaEntrega - 100000 WHERE VentaId = ?",
          [ids.venta]
        );
      }
    });

    test("cancha descuenta del cobro la parte que quedó a crédito", async () => {
      // Reserva pagada por 400.000 con 150.000 a crédito → cobrado 250.000.
      const t = await pedirTablero();
      assert.equal(linea(t, "CANCHA").monto, 250000);
    });

    test("el crédito se atribuye al mes de SU reserva, no al de la fila", async () => {
      // Es el bug de atribución que tenía la primera versión: si el crédito
      // se restara por `CanchaCreditoFecha`, moverlo a otro mes cambiaría el
      // resultado. Se mueve la fecha de la fila de crédito y el mes de la
      // reserva no debe moverse.
      await q(
        "UPDATE cancha_credito SET CanchaCreditoFecha = ? WHERE CanchaCreditoId = ?",
        [FANT(2), ids.credito]
      );
      try {
        const t = await pedirTablero();
        assert.equal(
          linea(t, "CANCHA").monto,
          250000,
          "el mes de la reserva no debe depender de la fecha de la fila de crédito"
        );
        const anterior = await pedirTablero(ANIO, MES - 1);
        assert.equal(
          linea(anterior, "CANCHA").monto,
          0,
          "el crédito no debe restar en el mes de su propia fecha"
        );
      } finally {
        await q(
          "UPDATE cancha_credito SET CanchaCreditoFecha = ? WHERE CanchaCreditoId = ?",
          [F(9), ids.credito]
        );
      }
    });

    test("un cobro de crédito suma en el mes en que entró la plata", async () => {
      await q(
        `INSERT INTO cancha_credito_pago (CanchaCreditoId, CanchaCreditoPagoId,
            CanchaCreditoPagoFecha, CanchaCreditoPagoMonto, CanchaCreditoPagoTipo, UsuarioId)
         VALUES (?, 1, ?, 50000, 'CO', ?)`,
        [ids.credito, F(22), usuarioId]
      );
      try {
        const t = await pedirTablero();
        assert.equal(linea(t, "CANCHA").monto, 300000);
      } finally {
        await q("DELETE FROM cancha_credito_pago WHERE CanchaCreditoId = ?", [
          ids.credito,
        ]);
      }
    });

    test("los ingresos totales son la suma de las tres líneas", async () => {
      const t = await pedirTablero();
      assert.equal(t.ingresos.monto, 300000 + 350000 + 250000);
    });

    test("la APERTURA DE CAJA no se cuenta como ingreso", async () => {
      // Hay una apertura de 999.999 en el mes. Si se colara, los ingresos
      // pasarían el millón.
      const t = await pedirTablero();
      assert.equal(t.ingresos.monto, 900000, "la apertura no debe sumar");
    });

    test("el CIERRE DE CAJA no se cuenta como egreso", async () => {
      // Hay un cierre de 888.888 en el mes; los egresos deben quedar en
      // 680.000 (compra + combustible).
      const t = await pedirTablero();
      assert.equal(t.egresos.monto, 680000);
      assert.equal(cat(t, "CIERRE DE CAJA"), undefined);
    });

    test("los egresos se agrupan por categoría con su nombre real", async () => {
      const t = await pedirTablero();
      assert.equal(cat(t, "COMPRA").monto, 600000);
      assert.equal(cat(t, "COMBUSTIBLE").monto, 80000);
      assert.equal(cat(t, "COMPRA").mesAnterior, 400000);
    });

    test("el resultado es ingresos menos egresos", async () => {
      const t = await pedirTablero();
      assert.equal(t.resultado.monto, 900000 - 680000);
    });

    test("una anulación de cancha no aparece como gasto ni como LAVADERO", async () => {
      // Migración 019: antes la anulación se escribía con grupo 7 del lado de
      // los EGRESOS, que en la taxonomía es LAVADERO, así que salía como un
      // gasto de lavadero en cualquier reporte por categoría.
      //
      // El ingreso de cancha no se toca acá: al anular, la reserva pasa a 'X'
      // y sale sola del filtro `= 'P'`.
      await mov(F(25), 1, 10, "TEST Anul. Contado #1", 100000);
      try {
        const t = await pedirTablero();
        assert.equal(
          cat(t, "ANULACION COBRO CANCHA"),
          undefined,
          "no debe listarse como categoría de egreso"
        );
        assert.equal(cat(t, "LAVADERO"), undefined, "y menos como LAVADERO");
        assert.equal(t.egresos.monto, 680000, "los egresos no cambian");
      } finally {
        await q(
          "DELETE FROM registrodiariocaja WHERE CajaId = ? AND TipoGastoGrupoId = 10",
          [ids.caja]
        );
      }
    });

    test("una reserva anulada ('X') sale del ingreso de cancha", async () => {
      await q(
        "UPDATE cancha_reserva SET CanchaReservaEstado = 'X' WHERE CanchaReservaId = ?",
        [ids.reserva]
      );
      try {
        const t = await pedirTablero();
        assert.equal(linea(t, "CANCHA").monto, 0);
      } finally {
        await q(
          "UPDATE cancha_reserva SET CanchaReservaEstado = 'P' WHERE CanchaReservaId = ?",
          [ids.reserva]
        );
      }
    });

    test("un mes sin movimientos devuelve todo en cero sin porcentajes", async () => {
      const t = await pedirTablero(ANIO, 1);
      assert.equal(t.ingresos.monto, 0);
      assert.equal(t.egresos.monto, 0);
      assert.equal(t.resultado.monto, 0);
      assert.equal(t.resultado.margenPct, null);
      assert.deepEqual(t.egresos.porCategoria, []);
    });

    test("declara la base y el mes de comparación", async () => {
      const t = await pedirTablero();
      assert.equal(t.base, "caja");
      assert.deepEqual(t.mesAnteriorRef, { anio: ANIO, mes: MES - 1 });
    });

    test("enero compara contra diciembre del año anterior", async () => {
      const t = await pedirTablero(ANIO, 1);
      assert.deepEqual(t.mesAnteriorRef, { anio: ANIO - 1, mes: 12 });
    });

    test("rechaza parámetros inválidos", async () => {
      await assert.rejects(() => pedirTablero(ANIO, 13), /400/);
      await assert.rejects(() => pedirTablero(1800, 5), /400/);
    });
  }
);
