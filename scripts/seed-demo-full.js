/**
 * Seed demo completo (Gimnasio + Cancha + Cantina + Caja).
 *
 * Reemplaza el estado transaccional con datos plausibles de los últimos
 * 3 meses + próxima semana para que el cliente pueda visualizar reportes,
 * calendarios y dashboards con números realistas.
 *
 * Conserva: catálogo de productos, proveedores, locales, almacenes, cajas,
 * usuarios, perfiles, menús, configuración. Borra y regenera todo lo demás.
 *
 * Ejecución:
 *   node scripts/seed-demo-full.js
 *
 * Idempotente: se puede correr varias veces; cada vez deja la BD en el
 * mismo estado.
 */

const path = require("path");
const apiNodeModules = path.join(__dirname, "..", "api", "node_modules");
require(path.join(apiNodeModules, "dotenv")).config({
  path: path.join(__dirname, "..", "api", ".env"),
});
const db = require(path.join(__dirname, "..", "api", "config", "db"));

// ============================================================
// Configuración
// ============================================================
const CLIENTES_COUNT = 30;
const MESES_HISTORIA = 3;
const PROB_MOROSO = 0.18; // 18% de socios con suscripciones pendientes
const CAJERO_USUARIO_ID = "faldama";
const CAJA_ID = 4; // CAJA GIMNASIO (verificar que exista)
const SEED = 20260520;

// Rango temporal
const HOY = new Date();
const INICIO_HISTORIA = new Date(HOY);
INICIO_HISTORIA.setMonth(INICIO_HISTORIA.getMonth() - MESES_HISTORIA);
const FIN_FUTURO = new Date(HOY);
FIN_FUTURO.setDate(FIN_FUTURO.getDate() + 7); // próxima semana

// ============================================================
// PRNG determinista
// ============================================================
let _rng = SEED;
function rand() {
  _rng = (_rng * 1664525 + 1013904223) % 4294967296;
  return _rng / 4294967296;
}
function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function pickWeighted(items) {
  // items: [{ peso, ... }]
  const total = items.reduce((a, x) => a + x.peso, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.peso;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// ============================================================
// Datos demográficos paraguayos
// ============================================================
const NOMBRES_M = ["JUAN", "CARLOS", "MIGUEL", "DIEGO", "JOSE", "LUIS", "PEDRO", "ANDRES", "FERNANDO", "RODRIGO", "MARCOS", "VICTOR", "PABLO", "GUSTAVO", "OSCAR", "ALEJANDRO", "MARTIN", "RAUL", "RICARDO", "SERGIO"];
const NOMBRES_F = ["MARIA", "ANA", "LUCIA", "SOFIA", "CAMILA", "VALENTINA", "PATRICIA", "ROCIO", "FATIMA", "CLAUDIA", "LAURA", "CECILIA", "VERONICA", "GABRIELA", "NATALIA", "DANIELA", "ANDREA", "JULIETA", "VICTORIA", "ISABEL"];
const APELLIDOS = ["GONZALEZ", "RODRIGUEZ", "MARTINEZ", "LOPEZ", "BENITEZ", "FERNANDEZ", "RAMIREZ", "VERA", "AYALA", "VILLALBA", "GIMENEZ", "CACERES", "OVELAR", "ROJAS", "DUARTE", "FRANCO", "ACOSTA", "RIVEROS", "ESCOBAR", "SOSA", "ORTIZ", "MEDINA", "CABALLERO", "RUIZ", "ARGUELLO"];
const BARRIOS = ["Asunción - Villa Morra", "Asunción - Recoleta", "Asunción - Trinidad", "Lambaré - Centro", "San Lorenzo - Sajonia", "Fernando de la Mora - Zona Norte", "Luque - Mora Cué", "Mariano Roque Alonso", "Capiata - Centro", "Ñemby - Centro"];

// ============================================================
// Catálogos
// ============================================================
const PLANES = [
  { nombre: "PASE DIARIO", duracion: 1, precio: 15000, permiteClases: 0, modalidad: "MENSUAL", cantClases: 0, peso: 0.05 },
  { nombre: "MENSUAL BASICO", duracion: 30, precio: 150000, permiteClases: 0, modalidad: "MENSUAL", cantClases: 0, peso: 0.30 },
  { nombre: "MENSUAL PREMIUM", duracion: 30, precio: 200000, permiteClases: 1, modalidad: "MENSUAL", cantClases: 0, peso: 0.30 },
  { nombre: "PAQUETE 12 CLASES", duracion: 60, precio: 180000, permiteClases: 1, modalidad: "CLASES", cantClases: 12, peso: 0.15 },
  { nombre: "TRIMESTRAL", duracion: 90, precio: 400000, permiteClases: 1, modalidad: "MENSUAL", cantClases: 0, peso: 0.15 },
  { nombre: "OPEN VIP", duracion: 365, precio: 0, permiteClases: 1, modalidad: "OPEN", cantClases: 0, peso: 0.05 },
];

const CANCHAS = [
  { nombre: "CANCHA 1 - SINTETICO", tarifa: 80000 },
  { nombre: "CANCHA 2 - SINTETICO", tarifa: 80000 },
  { nombre: "CANCHA 3 - GRAMA", tarifa: 100000 },
];

// Bandas de tarifa típicas (aplican a todas las canchas).
const BANDAS = [
  { nombre: "DIA NORMAL", dias: "L,M,X,J,V", desde: "06:00", hasta: "17:00", precio: 60000, prioridad: 0 },
  { nombre: "HORA PICO NOCTURNA", dias: "L,M,X,J,V", desde: "17:00", hasta: "23:00", precio: 100000, prioridad: 1 },
  { nombre: "FIN DE SEMANA", dias: "S,D", desde: "06:00", hasta: "23:00", precio: 120000, prioridad: 1 },
];

const PAGO_TIPOS = [
  // codigo: 2 chars para tablas de pago/suscripción (VentaTipo varchar(2)).
  // codigoVenta: 1 char para venta.VentaPagoTipo (varchar(1)) — E/P/T.
  { codigo: "CO", codigoVenta: "E", grupoId: 1, peso: 0.55, label: "Contado" },
  { codigo: "PO", codigoVenta: "P", grupoId: 4, peso: 0.30, label: "POS" },
  { codigo: "TR", codigoVenta: "T", grupoId: 6, peso: 0.15, label: "Transferencia" },
];

// ============================================================
// Helpers de fecha
// ============================================================
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function setTime(d, h, m, s = 0) {
  const r = new Date(d);
  r.setHours(h, m, s, 0);
  return r;
}
function clampToToday(d) {
  return d > HOY ? HOY : d;
}

// Día de semana sigla: 0=Dom..6=Sab → L,M,X,J,V,S,D
function siglaDia(d) {
  const map = ["D", "L", "M", "X", "J", "V", "S"];
  return map[d.getDay()];
}

// ============================================================
// CI/DV (Paraguay módulo 11)
// ============================================================
function calcularDV(numero) {
  const limpio = String(numero).replace(/\D/g, "");
  if (!limpio) return 0;
  let total = 0;
  let k = 2;
  for (let i = limpio.length - 1; i >= 0; i--) {
    if (k > 11) k = 2;
    total += parseInt(limpio[i], 10) * k;
    k++;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

// ============================================================
// Main
// ============================================================
// Promesa-friendly wrapper: usa la promise API del adapter (auto-commit
// por query). Devuelve `[rows]` para preservar la sintaxis de destructuración
// `const [r] = await conn.query(...)` que ya estaba en el script.
async function q(sql, params = []) {
  const [rows] = await db.promise().query(sql, params);
  return [rows];
}
// Alias para usar como una conexión "mysql2-like" en el resto del script.
const conn = { query: q };

// Resetea la secuencia asociada a una columna identity/serial si existe.
// Algunas tablas migradas de MySQL perdieron la secuencia y quedaron con
// `default 0` (ej. venta.ventaid). Detectamos ese caso y creamos la secuencia
// para que los INSERTs con RETURNING funcionen.
async function asegurarSecuencia(table, col) {
  try {
    const [defRows] = await q(
      `SELECT column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [table, col]
    );
    const def = defRows[0]?.column_default;
    if (def && def.startsWith("nextval(")) return; // ya tiene secuencia
    const seqName = `${table}_${col}_seq`;
    console.log(`  Creando secuencia ${seqName}...`);
    await q(`CREATE SEQUENCE IF NOT EXISTS ${seqName}`);
    await q(
      `SELECT setval('${seqName}', COALESCE((SELECT MAX(${col}) FROM ${table}), 0) + 1, false)`
    );
    await q(`ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT nextval('${seqName}')`);
    await q(`ALTER SEQUENCE ${seqName} OWNED BY ${table}.${col}`);
  } catch (e) {
    console.log(`  (skip ensure seq ${table}.${col}: ${e.message.split("\n")[0]})`);
  }
}

async function resetSeq(table, col) {
  try {
    const [rows] = await q(
      `SELECT pg_get_serial_sequence($1, $2) AS seq`,
      [table, col]
    );
    const seq = rows[0]?.seq;
    if (!seq) {
      console.log(`  (skip ${table}.${col}: sin secuencia identificable)`);
      return;
    }
    // pg_get_serial_sequence devuelve algo como 'public.plan_planid_seq'
    await q(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
  } catch (e) {
    console.log(`  (skip ${table}.${col}: ${e.message.split("\n")[0]})`);
  }
}

async function main() {
  console.log(`Conectado a ${process.env.DB_NAME}`);

  try {
    // ============================================================
    // 1) LIMPIEZA
    // ============================================================
    console.log("\n[1/8] Limpiando datos transaccionales...");

    // Orden FK-safe (hijos → padres). Cada query es su propio auto-commit
    // — si una falla, las siguientes pueden seguir corriendo.
    await q("DELETE FROM ventaproducto");
    await q("DELETE FROM ventacreditopago");
    await q("DELETE FROM ventacredito");
    await q("DELETE FROM venta");

    await q("DELETE FROM compraproducto");
    await q("DELETE FROM compra");

    await q("DELETE FROM pago");
    await q("DELETE FROM asistencia");
    await q("DELETE FROM suscripcion");

    await q("DELETE FROM cancha_reserva");
    await q("DELETE FROM cancha_tarifa");
    await q("DELETE FROM cancha");

    await q("DELETE FROM plan");

    // Movimientos de caja: solo de la caja demo para no afectar otras.
    await q("DELETE FROM registrodiariocaja WHERE CajaId = ?", [CAJA_ID]);

    // Clientes: preservamos los 2 placeholders (Id 1 y 2).
    await q("DELETE FROM clientes WHERE ClienteId > 2");

    // Asegurar que las tablas migradas tengan secuencia para sus PKs.
    await asegurarSecuencia("venta", "ventaid");
    await asegurarSecuencia("compra", "compraid");

    // Reset secuencias (autodetectadas). Solo para tablas vaciadas por
    // completo. `clientes` y `registrodiariocaja` solo se borran parcial,
    // así que sus secuencias deben seguir desde el último ID existente.
    await resetSeq("venta", "ventaid");
    await resetSeq("compra", "compraid");
    await resetSeq("pago", "pagoid");
    await resetSeq("asistencia", "asistenciaid");
    await resetSeq("suscripcion", "suscripcionid");
    await resetSeq("plan", "planid");
    await resetSeq("cancha", "canchaid");
    await resetSeq("cancha_reserva", "canchareservaid");
    await resetSeq("cancha_tarifa", "canchatarifaid");
    // clientes: reset al máximo+1 para no chocar con IDs preservados.
    await q(
      `SELECT setval(pg_get_serial_sequence('clientes','clienteid'),
                     COALESCE((SELECT MAX(ClienteId) FROM clientes), 0) + 1,
                     false)`
    );
    // registrodiariocaja: similar.
    await q(
      `SELECT setval(pg_get_serial_sequence('registrodiariocaja','registrodiariocajaid'),
                     COALESCE((SELECT MAX(RegistroDiarioCajaId) FROM registrodiariocaja), 0) + 1,
                     false)`
    );

    // Reset caja demo a 0
    await q("UPDATE caja SET CajaMonto = 0 WHERE CajaId = ?", [CAJA_ID]);

    // ============================================================
    // 2) PLANES
    // ============================================================
    console.log("\n[2/8] Insertando planes...");
    const planIds = [];
    for (const p of PLANES) {
      const [r] = await conn.query(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanPermiteClases, PlanActivo, PlanModalidad, PlanCantidadClases)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [p.nombre, p.duracion, p.precio, p.permiteClases, p.modalidad, p.cantClases]
      );
      planIds.push(r.insertId);
    }
    console.log(`  ${planIds.length} planes`);

    // ============================================================
    // 3) CLIENTES
    // ============================================================
    console.log(`\n[3/8] Insertando ${CLIENTES_COUNT} clientes...`);
    const clienteIds = [];
    const clientesData = [];
    for (let i = 0; i < CLIENTES_COUNT; i++) {
      const esFem = rand() < 0.45;
      const nombre = pick(esFem ? NOMBRES_F : NOMBRES_M);
      const apellido = `${pick(APELLIDOS)} ${pick(APELLIDOS)}`;
      const razon = `${apellido}, ${nombre}`;
      const ci = String(1500000 + randInt(1, 4500000));
      const dv = String(calcularDV(ci));
      const tel = `09${randInt(61, 99)}${String(randInt(100000, 999999))}`;
      const dir = pick(BARRIOS);
      const anioNac = randInt(1970, 2007);
      const mesNac = randInt(1, 12);
      const diaNac = randInt(1, 28);
      const fechaNac = `${anioNac}-${String(mesNac).padStart(2, "0")}-${String(diaNac).padStart(2, "0")}`;
      const [r] = await conn.query(
        `INSERT INTO clientes
         (ClienteRUC, ClienteDV, ClienteRazonSocial, ClienteNombre, ClienteApellido, ClienteDireccion, ClienteTelefono, ClienteTipo, UsuarioId, ClienteFechaNacimiento)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'MI', ?, ?)`,
        [ci, dv, razon, nombre, apellido, dir, tel, CAJERO_USUARIO_ID, fechaNac]
      );
      clienteIds.push(r.insertId);
      clientesData.push({ id: r.insertId, nombre, apellido, tel });
    }
    console.log(`  ${clienteIds.length} clientes`);

    // ============================================================
    // 4) CANCHAS + TARIFAS
    // ============================================================
    console.log("\n[4/8] Insertando canchas y tarifas...");
    const canchaIds = [];
    for (const c of CANCHAS) {
      const [r] = await conn.query(
        `INSERT INTO cancha (CanchaNombre, CanchaTarifaHora, CanchaActiva) VALUES (?, ?, 1)`,
        [c.nombre, c.tarifa]
      );
      canchaIds.push(r.insertId);
      // Bandas: cada cancha tiene las 3 bandas estándar.
      for (const b of BANDAS) {
        await conn.query(
          `INSERT INTO cancha_tarifa
           (CanchaId, CanchaTarifaNombre, CanchaTarifaDiasSemana, CanchaTarifaHoraDesde, CanchaTarifaHoraHasta, CanchaTarifaPrecio, CanchaTarifaPrioridad, CanchaTarifaActiva)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [r.insertId, b.nombre, b.dias, b.desde, b.hasta, b.precio, b.prioridad]
        );
      }
    }
    console.log(`  ${canchaIds.length} canchas con ${BANDAS.length} bandas c/u`);

    // ============================================================
    // 5) SUSCRIPCIONES + PAGOS + ASISTENCIAS
    // ============================================================
    console.log("\n[5/8] Generando suscripciones, pagos y asistencias...");
    // Map fecha → array de pagos para alimentar registrodiariocaja después.
    const pagosPorDia = new Map();
    function registrarPago(fecha, monto, tipo, detalle) {
      const k = fmtDate(fecha);
      if (!pagosPorDia.has(k)) pagosPorDia.set(k, []);
      pagosPorDia.get(k).push({ fecha, monto, tipo, detalle });
    }

    let totalSuscripciones = 0;
    let totalPagos = 0;
    let totalAsistencias = 0;

    for (const clienteId of clienteIds) {
      // Primer ingreso aleatorio dentro del histórico.
      const offsetIngreso = randInt(0, MESES_HISTORIA * 30 - 15);
      let fechaInicio = addDays(INICIO_HISTORIA, offsetIngreso);

      const esMoroso = rand() < PROB_MOROSO;

      // Encadenar suscripciones hasta cerca de HOY.
      let planIdxActual = pickWeighted(PLANES.map((p, i) => ({ peso: p.peso, idx: i }))).idx;

      while (fechaInicio < HOY) {
        const plan = PLANES[planIdxActual];
        const fechaFin = addDays(fechaInicio, plan.duracion - 1);

        // Estado: si la fecha fin es < HOY, calcular si pagó; sino activa/futura.
        let estado = "ACTIVA";
        if (fechaFin < HOY) estado = "VENCIDA";
        // Estado se mantiene como cadena vacía o letras según convención.
        // Vamos a usar lo que use el sistema. Para simplificar dejo vacío que
        // significa "vigente segun fechas" (lo recalcula el frontend).

        const cupoInicial = plan.modalidad === "CLASES" ? plan.cantClases : 0;
        const [rs] = await conn.query(
          `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [clienteId, planIds[planIdxActual], fmtDate(fechaInicio), fmtDate(fechaFin), "", cupoInicial]
        );
        const suscripcionId = rs.insertId;
        totalSuscripciones++;

        // Pago: si moroso y es la ÚLTIMA del histórico, podría dejarla impaga.
        const proximaInicio = addDays(fechaFin, 1);
        const esUltima = proximaInicio >= HOY;
        const pagar = !(esMoroso && esUltima);
        if (pagar && plan.precio > 0) {
          // Pagar 1 a 3 días después del inicio.
          const fechaPago = setTime(
            addDays(fechaInicio, randInt(0, 3)),
            randInt(9, 19),
            randInt(0, 59)
          );
          const tipoPago = pickWeighted(PAGO_TIPOS);
          await conn.query(
            `INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId)
             VALUES (?, ?, ?, ?, ?)`,
            [suscripcionId, plan.precio, tipoPago.codigo, fmtDateTime(fechaPago), CAJERO_USUARIO_ID]
          );
          totalPagos++;
          registrarPago(fechaPago, plan.precio, tipoPago, `Pago plan ${plan.nombre}`);
        }

        // Asistencias: si el plan permite clases.
        if (plan.permiteClases) {
          const desdeAsist = fechaInicio;
          const hastaAsist = clampToToday(fechaFin);
          let cursor = new Date(desdeAsist);
          let clasesRestantes = cupoInicial; // se descuenta si modalidad CLASES
          while (cursor <= hastaAsist) {
            const probAsist = plan.modalidad === "CLASES" ? 0.4 : 0.55;
            if (rand() < probAsist) {
              if (plan.modalidad === "CLASES" && clasesRestantes <= 0) {
                break; // cupo agotado
              }
              const h = randInt(7, 21);
              const m = randInt(0, 59);
              const entrada = setTime(cursor, h, m);
              await conn.query(
                `INSERT INTO asistencia (ClienteId, AsistenciaFecha, AsistenciaHoraEntrada)
                 VALUES (?, ?, ?)`,
                [clienteId, fmtDate(cursor), fmtDateTime(entrada)]
              );
              totalAsistencias++;
              if (plan.modalidad === "CLASES") clasesRestantes--;
            }
            cursor = addDays(cursor, 1);
          }
          // Si modalidad CLASES, actualizar SuscripcionClasesRestantes con el valor final.
          if (plan.modalidad === "CLASES") {
            await conn.query(
              `UPDATE suscripcion SET SuscripcionClasesRestantes = ? WHERE SuscripcionId = ?`,
              [Math.max(0, clasesRestantes), suscripcionId]
            );
          }
        }

        // Siguiente plan: 70% mantener, 30% cambiar.
        if (rand() >= 0.7) {
          planIdxActual = pickWeighted(PLANES.map((p, i) => ({ peso: p.peso, idx: i }))).idx;
        }
        fechaInicio = addDays(fechaFin, 1);
      }
    }
    console.log(`  ${totalSuscripciones} suscripciones, ${totalPagos} pagos, ${totalAsistencias} asistencias`);

    // ============================================================
    // 6) RESERVAS DE CANCHA
    // ============================================================
    console.log("\n[6/8] Generando reservas de cancha...");
    let totalReservas = 0;
    // Recorrer cada día del rango [INICIO_HISTORIA, FIN_FUTURO] y generar
    // 0..5 reservas. Más densidad en fines de semana y horas pico.
    const cursorReservas = new Date(INICIO_HISTORIA);
    while (cursorReservas <= FIN_FUTURO) {
      const diaJS = cursorReservas.getDay(); // 0=Dom..6=Sab
      const esFinde = diaJS === 0 || diaJS === 6;
      const reservasHoy = esFinde ? randInt(3, 8) : randInt(1, 5);
      // Para no chocar entre sí, asignamos horarios secuenciales por cancha
      // distribuidos a lo largo del día.
      const ocupacionPorCancha = new Map();
      for (let i = 0; i < reservasHoy; i++) {
        const canchaId = pick(canchaIds);
        if (!ocupacionPorCancha.has(canchaId))
          ocupacionPorCancha.set(canchaId, []);
        // Hora inicio: 06-22 (deja 1h mínimo). Aleatorio, con preferencia
        // a horas pico nocturnas (18-21).
        let horaIni;
        if (rand() < 0.55) horaIni = randInt(18, 21);
        else horaIni = randInt(6, 17);
        const minIni = pick([0, 30]);
        const duracionMin = pick([60, 60, 60, 90, 120]);
        const inicioReserva = setTime(cursorReservas, horaIni, minIni);
        const finReserva = new Date(inicioReserva);
        finReserva.setMinutes(finReserva.getMinutes() + duracionMin);
        if (finReserva.getHours() > 23 ||
            (finReserva.getHours() === 23 && finReserva.getMinutes() > 0)) continue;

        // Chequear overlap manual con las ya creadas en esta cancha hoy.
        const ya = ocupacionPorCancha.get(canchaId);
        const choca = ya.some((r) => inicioReserva < r.fin && finReserva > r.inicio);
        if (choca) continue;
        ya.push({ inicio: inicioReserva, fin: finReserva });

        // Cliente: 70% vinculado, 30% invitado.
        let clienteIdReserva = null;
        let nombreInvitado = "";
        if (rand() < 0.7) {
          clienteIdReserva = pick(clienteIds);
        } else {
          const n = pick(NOMBRES_M.concat(NOMBRES_F));
          const a = pick(APELLIDOS);
          nombreInvitado = `${n} ${a}`;
        }

        // Calcular monto según banda aplicable.
        const sigla = siglaDia(cursorReservas);
        let precioHora = 60000;
        for (const b of BANDAS) {
          if (!b.dias.includes(sigla)) continue;
          const horaActual = `${String(horaIni).padStart(2, "0")}:${String(minIni).padStart(2, "0")}`;
          if (horaActual >= b.desde && horaActual < b.hasta) {
            if (b.prioridad >= 0) precioHora = b.precio;
          }
        }
        const monto = Math.round((duracionMin / 60) * precioHora);

        // Estado: si fecha pasada, mayoritariamente "P" (pagada). Si futura, "R".
        let estado;
        if (cursorReservas < HOY) {
          estado = rand() < 0.85 ? "P" : (rand() < 0.5 ? "R" : "X");
        } else {
          estado = rand() < 0.4 ? "P" : "R";
        }

        await conn.query(
          `INSERT INTO cancha_reserva
           (CanchaId, ClienteId, CanchaReservaCliente, CanchaReservaFecha, CanchaReservaHoraInicio, CanchaReservaHoraFin, CanchaReservaMonto, CanchaReservaEstado, CanchaReservaObservacion, UsuarioId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
          [
            canchaId,
            clienteIdReserva,
            nombreInvitado,
            fmtDate(cursorReservas),
            fmtDateTime(inicioReserva),
            fmtDateTime(finReserva),
            monto,
            estado,
            CAJERO_USUARIO_ID,
          ]
        );
        totalReservas++;
        // Si está pagada, registrar el ingreso del día para caja.
        if (estado === "P" && cursorReservas < HOY) {
          const tipoPago = pickWeighted(PAGO_TIPOS);
          registrarPago(
            inicioReserva,
            monto,
            tipoPago,
            `Reserva cancha ${canchaId}`
          );
        }
      }
      cursorReservas.setDate(cursorReservas.getDate() + 1);
    }
    console.log(`  ${totalReservas} reservas`);

    // ============================================================
    // 7) VENTAS Y COMPRAS DE CANTINA
    // ============================================================
    console.log("\n[7/8] Generando ventas y compras de cantina...");
    // Obtener algunos productos para usar en ventas y compras.
    const [productosRows] = await conn.query(
      `SELECT ProductoId, ProductoPrecioVenta, ProductoPrecioPromedio
       FROM producto
       WHERE ProductoPrecioVenta > 0
       ORDER BY ProductoId
       LIMIT 100`
    );
    const productos = productosRows.map((p) => ({
      id: p.ProductoId,
      precio: Number(p.ProductoPrecioVenta) || 0,
      promedio: Number(p.ProductoPrecioPromedio) || 0,
    }));

    const [almacenes] = await conn.query("SELECT AlmacenId FROM almacen LIMIT 5");
    const almacenId = almacenes[0]?.AlmacenId || 1;

    const [proveedores] = await conn.query(
      "SELECT ProveedorId FROM proveedor LIMIT 20"
    );
    const provIds = proveedores.map((p) => p.ProveedorId);

    let totalVentas = 0;
    let totalCompras = 0;

    if (productos.length === 0) {
      console.log("  ⚠ sin productos en catálogo, salteando ventas/compras");
    } else {
      const cursorComercio = new Date(INICIO_HISTORIA);
      while (cursorComercio < HOY) {
        const diaJS = cursorComercio.getDay();
        const esFinde = diaJS === 0 || diaJS === 6;
        // 3-8 ventas por día hábil, 5-12 fin de semana.
        const ventasHoy = esFinde ? randInt(5, 12) : randInt(3, 8);
        for (let v = 0; v < ventasHoy; v++) {
          const tipoPago = pickWeighted(PAGO_TIPOS);
          const cantItems = randInt(1, 4);
          const items = [];
          let totalVenta = 0;
          for (let it = 0; it < cantItems; it++) {
            const prod = pick(productos);
            const cant = randInt(1, 3);
            const precio = prod.precio;
            const subtotal = precio * cant;
            items.push({ ...prod, cant, precio, subtotal });
            totalVenta += subtotal;
          }
          const horaVenta = randInt(8, 22);
          const minVenta = randInt(0, 59);
          const fechaVenta = setTime(cursorComercio, horaVenta, minVenta);
          // Cliente: 30% un cliente registrado, 70% mostrador (id 1).
          const clienteVenta = rand() < 0.3 ? pick(clienteIds) : 1;
          const [rv] = await conn.query(
            `INSERT INTO venta
             (VentaFecha, ClienteId, AlmacenId, VentaTipo, VentaPagoTipo, VentaCantidadProductos, VentaUsuario, Total, VentaEntrega, VentaNroFactura, VentaTimbrado, VentaNroPOS)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
            [
              fmtDateTime(fechaVenta),
              clienteVenta,
              almacenId,
              tipoPago.codigo,
              tipoPago.codigoVenta,
              cantItems,
              CAJERO_USUARIO_ID,
              totalVenta,
              totalVenta,
            ]
          );
          const ventaId = rv.insertId;
          // Items
          let lineIdx = 1;
          for (const it of items) {
            await conn.query(
              `INSERT INTO ventaproducto
               (VentaId, VentaProductoId, ProductoId, VentaProductoPrecioPromedio, VentaProductoCantidad, VentaProductoPrecio, VentaProductoPrecioTotal, VentaProductoUnitario)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'U')`,
              [
                ventaId,
                lineIdx++,
                it.id,
                Math.round(it.promedio || it.precio * 0.7),
                it.cant,
                it.precio,
                it.subtotal,
              ]
            );
          }
          totalVentas++;
          registrarPago(fechaVenta, totalVenta, tipoPago, `Venta ${ventaId}`);
        }
        cursorComercio.setDate(cursorComercio.getDate() + 1);
      }
      console.log(`  ${totalVentas} ventas`);

      // Compras: 2 por semana en el histórico.
      if (provIds.length > 0) {
        const cursorCompras = new Date(INICIO_HISTORIA);
        let semanaIdx = 0;
        while (cursorCompras < HOY) {
          if (semanaIdx % 7 === 0 || semanaIdx % 7 === 3) {
            // Compra
            const provId = pick(provIds);
            const cantItems = randInt(3, 8);
            const items = [];
            for (let it = 0; it < cantItems; it++) {
              const prod = pick(productos);
              const cant = randInt(5, 30);
              const precio = (prod.promedio || prod.precio * 0.65) * 1; // precio compra
              items.push({ ...prod, cant, precio });
            }
            const fechaCompra = setTime(cursorCompras, randInt(9, 17), randInt(0, 59));
            const [rc] = await conn.query(
              `INSERT INTO compra
               (CompraFecha, ProveedorId, UsuarioId, CompraFactura, CompraTipo, CompraPagoCompleto, CompraEntrega, CompraCantidadProductos)
               VALUES (?, ?, ?, ?, 'CO', 'S', 0, ?)`,
              [fmtDateTime(fechaCompra), provId, CAJERO_USUARIO_ID, randInt(10000, 99999), cantItems]
            );
            const compraId = rc.insertId;
            let lineIdx = 1;
            for (const it of items) {
              await conn.query(
                `INSERT INTO compraproducto
                 (CompraId, CompraProductoId, ProductoId, CompraProductoCantidad, CompraProductoCantidadUnidad, CompraProductoBonificacion, CompraProductoPrecio, AlmacenOrigenId)
                 VALUES (?, ?, ?, ?, 'U', 0, ?, ?)`,
                [compraId, lineIdx++, it.id, it.cant, it.precio, almacenId]
              );
            }
            totalCompras++;
          }
          semanaIdx++;
          cursorCompras.setDate(cursorCompras.getDate() + 1);
        }
        console.log(`  ${totalCompras} compras`);
      }
    }

    // ============================================================
    // 8) REGISTRO DIARIO CAJA (apertura/movimientos/cierre)
    // ============================================================
    console.log("\n[8/8] Generando movimientos de caja...");
    let totalMovs = 0;
    const cursorCaja = new Date(INICIO_HISTORIA);
    while (cursorCaja < HOY) {
      const diaKey = fmtDate(cursorCaja);
      const pagosDelDia = pagosPorDia.get(diaKey) || [];
      if (pagosDelDia.length === 0) {
        cursorCaja.setDate(cursorCaja.getDate() + 1);
        continue;
      }
      // Apertura: 06:30
      const apertura = setTime(cursorCaja, 6, 30);
      const montoApertura = randInt(50, 200) * 1000;
      await conn.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, 2, 2, ?, ?, ?)`,
        [CAJA_ID, fmtDateTime(apertura), `Apertura caja`, montoApertura, CAJERO_USUARIO_ID]
      );
      totalMovs++;

      // Movimientos = los pagos del día
      let totalIngresoEfectivo = montoApertura;
      for (const p of pagosDelDia) {
        await conn.query(
          `INSERT INTO registrodiariocaja
           (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
           VALUES (?, ?, 2, ?, ?, ?, ?)`,
          [CAJA_ID, fmtDateTime(p.fecha), p.tipo.grupoId, p.detalle, p.monto, CAJERO_USUARIO_ID]
        );
        totalMovs++;
        if (p.tipo.codigo === "CO") totalIngresoEfectivo += p.monto;
      }

      // Cierre: 22:30
      const cierre = setTime(cursorCaja, 22, 30);
      await conn.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, 1, 2, ?, ?, ?)`,
        [CAJA_ID, fmtDateTime(cierre), `Cierre caja`, totalIngresoEfectivo, CAJERO_USUARIO_ID]
      );
      totalMovs++;

      cursorCaja.setDate(cursorCaja.getDate() + 1);
    }
    console.log(`  ${totalMovs} movimientos de caja`);

    // ============================================================
    console.log("\n✓ Seed completado. Resumen:");
    console.log(`  Clientes:       ${CLIENTES_COUNT}`);
    console.log(`  Planes:         ${planIds.length}`);
    console.log(`  Canchas:        ${canchaIds.length} (con ${BANDAS.length} bandas c/u)`);
    console.log(`  Suscripciones:  ${totalSuscripciones}`);
    console.log(`  Pagos gimnasio: ${totalPagos}`);
    console.log(`  Asistencias:    ${totalAsistencias}`);
    console.log(`  Reservas:       ${totalReservas}`);
    console.log(`  Ventas:         ${totalVentas}`);
    console.log(`  Compras:        ${totalCompras}`);
    console.log(`  Mov. caja:      ${totalMovs}`);
  } catch (e) {
    console.error("\n✗ Error durante el seed:");
    console.error(e);
    process.exitCode = 1;
  }
}

main().then(() => process.exit(0));
