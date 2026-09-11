const db = require("../config/db");
const { todayLocalISO, addDaysLocal } = require("../utils/dateUtils");
const { escapeLike } = require("../utils/sql");
const { calcularEstadoPorFechas } = require("../utils/suscripcionEstado");

/**
 * Recalcula el estado de VIGENCIA al vuelo a partir de las fechas, en lugar de
 * confiar en la columna `SuscripcionEstado` (que se congela al crear/editar y
 * no refleja el paso del tiempo). Preserva los estados MANUALES C (Cancelada)
 * y S (Suspendida), que no dependen de fechas. Así los listados/reportes que
 * pasan por el modelo siempre devuelven A/V/F correctos para "hoy".
 */
function conEstadoVigente(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => {
    if (!r || r.SuscripcionEstado === "C" || r.SuscripcionEstado === "S") {
      return r;
    }
    return {
      ...r,
      SuscripcionEstado: calcularEstadoPorFechas(
        r.SuscripcionFechaInicio,
        r.SuscripcionFechaFin
      ),
    };
  });
}

/**
 * Construye condiciones WHERE para filtrar suscripciones en el backend (en vez
 * de filtrar la página visible en el cliente, que daba resultados engañosos).
 *   - filters.estado: 'A' | 'V' | 'F' | 'C' | 'S' (vigencia calculada por fechas;
 *     C/S son manuales). Requiere alias `s` de suscripcion.
 *   - filters.pago: 'PAGADA' | 'PENDIENTE'. Requiere alias `p` (plan) y el join
 *     LATERAL `pg` con `pg.totalpagado`.
 * Devuelve { conds: string[], params: any[] } para intercalar en la query.
 */
function buildSuscripcionFilters(filters = {}) {
  const conds = [];
  const params = [];
  const estado = filters.estado;
  if (estado === "C" || estado === "S") {
    conds.push("s.SuscripcionEstado = ?");
    params.push(estado);
  } else if (estado === "A") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(?) BETWEEN DATE(s.SuscripcionFechaInicio) AND DATE(s.SuscripcionFechaFin)"
    );
    params.push(todayLocalISO());
  } else if (estado === "V") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(s.SuscripcionFechaFin) < DATE(?)"
    );
    params.push(todayLocalISO());
  } else if (estado === "F") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(s.SuscripcionFechaInicio) > DATE(?)"
    );
    params.push(todayLocalISO());
  }
  const pago = filters.pago;
  if (pago === "PAGADA") {
    conds.push("(COALESCE(p.PlanPrecio,0) = 0 OR pg.totalpagado >= p.PlanPrecio)");
  } else if (pago === "PENDIENTE") {
    conds.push("(COALESCE(p.PlanPrecio,0) > 0 AND pg.totalpagado < p.PlanPrecio)");
  }
  return { conds, params };
}

const Suscripcion = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
      `;
      db.query(query, (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*, 
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        WHERE s.SuscripcionId = ?
      `;
      db.query(query, [id], (err, results) => {
        if (err) return reject(err);
        resolve(results.length > 0 ? conEstadoVigente(results)[0] : null);
      });
    });
  },

  create: (suscripcionData) => {
    return new Promise((resolve, reject) => {
      const estado =
        suscripcionData.SuscripcionEstado ||
        calcularEstadoPorFechas(
          suscripcionData.SuscripcionFechaInicio,
          suscripcionData.SuscripcionFechaFin
        );
      // Para modalidad CLASES inicializamos el cupo desde el plan asociado.
      // Para MENSUAL/OPEN queda en 0 (no se usa).
      db.query(
        "SELECT PlanModalidad, PlanCantidadClases FROM plan WHERE PlanId = ?",
        [suscripcionData.PlanId],
        (err, planRows) => {
          if (err) return reject(err);
          const modalidad = planRows[0]?.PlanModalidad || "MENSUAL";
          const cupoInicial =
            modalidad === "CLASES"
              ? Number(planRows[0]?.PlanCantidadClases || 0)
              : 0;
          const clasesRestantes =
            suscripcionData.SuscripcionClasesRestantes !== undefined
              ? Number(suscripcionData.SuscripcionClasesRestantes)
              : cupoInicial;
          const query = `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes) VALUES (?, ?, ?, ?, ?, ?)`;
          const values = [
            suscripcionData.ClienteId,
            suscripcionData.PlanId,
            suscripcionData.SuscripcionFechaInicio,
            suscripcionData.SuscripcionFechaFin,
            estado,
            clasesRestantes,
          ];
          db.query(query, values, (err2, result) => {
            if (err2) return reject(err2);
            Suscripcion.getById(result.insertId)
              .then((suscripcion) => resolve(suscripcion))
              .catch((error) => reject(error));
          });
        }
      );
    });
  },

  update: (id, suscripcionData) => {
    return new Promise((resolve, reject) => {
      // Si vino estado manual (CANCELADA/SUSPENDIDA) se respeta; si no, se recalcula.
      const estado =
        suscripcionData.SuscripcionEstado ||
        calcularEstadoPorFechas(
          suscripcionData.SuscripcionFechaInicio,
          suscripcionData.SuscripcionFechaFin
        );
      // SuscripcionClasesRestantes ahora es editable. Si llega `undefined`
      // (formularios que no lo manejan), usamos COALESCE en SQL para no
      // sobrescribir el cupo existente con NULL. Si llega un número, se
      // respeta (permite al operador corregir errores de carga).
      const clasesParam =
        suscripcionData.SuscripcionClasesRestantes === undefined
          ? null
          : Number(suscripcionData.SuscripcionClasesRestantes);
      const query = `
        UPDATE suscripcion
        SET ClienteId = ?,
            PlanId = ?,
            SuscripcionFechaInicio = ?,
            SuscripcionFechaFin = ?,
            SuscripcionEstado = ?,
            SuscripcionClasesRestantes = COALESCE(?, SuscripcionClasesRestantes)
        WHERE SuscripcionId = ?`;
      const values = [
        suscripcionData.ClienteId,
        suscripcionData.PlanId,
        suscripcionData.SuscripcionFechaInicio,
        suscripcionData.SuscripcionFechaFin,
        estado,
        clasesParam,
        id,
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        if (result.affectedRows === 0) return resolve(null);
        Suscripcion.getById(id)
          .then((suscripcion) => resolve(suscripcion))
          .catch((error) => reject(error));
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM suscripcion WHERE SuscripcionId = ?",
        [id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        },
      );
    });
  },

  getAllPaginated: (
    limit,
    offset,
    sortBy = "SuscripcionId",
    sortOrder = "ASC",
    filters = {},
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "SuscripcionId",
        "ClienteId",
        "PlanId",
        "SuscripcionFechaInicio",
        "SuscripcionFechaFin",
        "ClienteNombre",
        "PlanNombre",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "SuscripcionId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      // Para ordenar por campos de tablas relacionadas, necesitamos usar alias
      let orderByField = sortField;
      if (sortField === "ClienteNombre") {
        orderByField = "c.ClienteNombre";
      } else if (sortField === "PlanNombre") {
        orderByField = "p.PlanNombre";
      } else {
        orderByField = `s.${sortField}`;
      }

      const { conds, params: filterParams } = buildSuscripcionFilters(filters);
      const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        ${whereSql}
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;

      db.query(query, [...filterParams, limit, offset], (err, results) => {
        if (err) return reject(err);

        // El COUNT debe replicar los joins que usan los filtros (plan para
        // PlanPrecio, LATERAL pago para totalpagado) y el mismo WHERE.
        const countQuery = `
          SELECT COUNT(*) as total
          FROM suscripcion s
          LEFT JOIN plan p ON s.PlanId = p.PlanId
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
            FROM pago WHERE SuscripcionId = s.SuscripcionId
          ) pg ON true
          ${whereSql}
        `;
        db.query(countQuery, filterParams, (err, countResult) => {
          if (err) return reject(err);

          resolve({
            suscripciones: conEstadoVigente(results),
            total: countResult[0].total,
          });
        });
      });
    });
  },

  searchSuscripciones: (
    term,
    limit,
    offset,
    sortBy = "SuscripcionId",
    sortOrder = "ASC",
    filters = {},
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "SuscripcionId",
        "ClienteId",
        "PlanId",
        "SuscripcionFechaInicio",
        "SuscripcionFechaFin",
        "ClienteNombre",
        "PlanNombre",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "SuscripcionId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      let orderByField = sortField;
      if (sortField === "ClienteNombre") {
        orderByField = "c.ClienteNombre";
      } else if (sortField === "PlanNombre") {
        orderByField = "p.PlanNombre";
      } else {
        orderByField = `s.${sortField}`;
      }

      const { conds, params: filterParams } = buildSuscripcionFilters(filters);
      const filterAnd = conds.length ? ` AND ${conds.join(" AND ")}` : "";

      // El operador de mostrador busca por cédula/RUC casi siempre. Agregamos
      // ClienteRUC al OR para evitar tener que ir a Clientes primero a buscar
      // por nombre + copiar el ID.
      const searchQuery = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        WHERE (
          c.ClienteNombre LIKE ?
          OR c.ClienteApellido LIKE ?
          OR c.ClienteRUC LIKE ?
          OR p.PlanNombre LIKE ?
          OR CAST(s.SuscripcionId AS CHAR) LIKE ?
        )${filterAnd}
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;
      const searchValue = `%${escapeLike(term)}%`;

      db.query(
        searchQuery,
        [
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          ...filterParams,
          limit,
          offset,
        ],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `
            SELECT COUNT(*) as total
            FROM suscripcion s
            LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
            LEFT JOIN plan p ON s.PlanId = p.PlanId
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
              FROM pago WHERE SuscripcionId = s.SuscripcionId
            ) pg ON true
            WHERE (
              c.ClienteNombre LIKE ?
              OR c.ClienteApellido LIKE ?
              OR c.ClienteRUC LIKE ?
              OR p.PlanNombre LIKE ?
              OR CAST(s.SuscripcionId AS CHAR) LIKE ?
            )${filterAnd}
          `;
          db.query(
            countQuery,
            [
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              ...filterParams,
            ],
            (err, countResult) => {
              if (err) return reject(err);
              resolve({
                suscripciones: conEstadoVigente(results),
                total: countResult[0]?.total || 0,
              });
            },
          );
        },
      );
    });
  },

  getByClienteId: (clienteId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago,
          COALESCE(pg.totalpagado, 0) as TotalPagado
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        WHERE s.ClienteId = ?
        ORDER BY s.SuscripcionFechaInicio DESC
      `;
      db.query(query, [clienteId], (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },

  /**
   * Lista de trabajo de vencimientos: a quién hay que llamar para que renueve.
   *
   * En un gimnasio el cobro y la retención son lo mismo, porque el acceso es
   * prepago (ver `Asistencia.estadoAcceso`, que bloquea la entrada). Así que
   * esta lista es la herramienta de cobranza real, más que un reporte de
   * antigüedad de deuda.
   *
   * @param {number} dias          ventana hacia adelante (por vencer).
   * @param {number} limit         corte de filas (null = todas).
   * @param {number} clasesMin     umbral de clases restantes para que un plan
   *                               de modalidad CLASES entre en la lista.
   * @param {number} diasVencidos  ventana hacia atrás. Cuántos días de
   *                               vencidos siguen en la lista.
   *
   *                               El default es 7 por compatibilidad con el
   *                               widget del Dashboard, pero para una lista de
   *                               trabajo conviene 30: el socio que venció
   *                               hace dos semanas y dejó de venir es el
   *                               llamado de mayor valor, y con 7 días era
   *                               invisible. Más allá de ~30 días la
   *                               recuperación en un gimnasio es marginal.
   *
   * QUÉ RESUELVE, caso por caso:
   *
   *   * Socio con suscripciones SOLAPADAS o que ya renovó: no aparece. El
   *     INNER JOIN toma sólo la vigencia más lejana de cada cliente, así que
   *     alguien con un plan venciendo el viernes y otro corriendo hasta fin
   *     de mes no entra a la lista.
   *   * Canceladas y suspendidas: excluidas, y también del cálculo del MAX —
   *     si no, una cancelada con fecha lejana ganaba el MAX y el cliente
   *     desaparecía aunque tuviera una vigente venciendo en días.
   *   * Planes por CLASES: entran por cupo agotándose, no sólo por fecha. Un
   *     socio con 1 clase restante se queda sin acceso el próximo ingreso
   *     aunque su fecha fin esté lejos; antes era invisible en esta lista.
   *   * Pago parcial: se devuelve el SALDO en guaraníes, no sólo
   *     PAGADA/PENDIENTE, porque lo que se va a cobrar es ese número.
   *   * Última asistencia: es lo que cambia la conversación. El que viene
   *     todos los días y se le venció se olvidó (renovación casi segura); el
   *     que no viene desde tres semanas ya se fue. Sin ese dato las dos filas
   *     se ven iguales.
   */
  getProximasAVencer: (dias = 30, limit = null, clasesMin = 2, diasVencidos = 7) => {
    return new Promise((resolve, reject) => {
      // Rango basado en fecha local del servidor (no UTC).
      const hoyISO = todayLocalISO();
      const fechaDesdeFormateada = addDaysLocal(hoyISO, -Math.abs(diasVencidos));
      const fechaLimiteFormateada = addDaysLocal(hoyISO, dias);

      const hasLimit = limit != null && limit > 0;
      const baseSelect = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido, c.ClienteTelefono, c.ClienteRUC,
          p.PlanNombre, p.PlanPrecio, p.PlanModalidad, p.PlanCantidadClases,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago,
          GREATEST(COALESCE(p.PlanPrecio, 0) - COALESCE(pg.totalpagado, 0), 0)
            AS SaldoPendiente,
          asi.ultima AS UltimaAsistencia,
          -- Días sin venir contra la fecha LOCAL del servidor, pasada por
          -- parámetro. Con CURRENT_DATE la cifra dependería de la zona
          -- horaria del motor de base: si la base corre en UTC, entre las
          -- 21:00 y las 23:59 locales CURRENT_DATE ya es mañana y el socio
          -- que vino hoy aparecería con un día de ausencia. Es el mismo
          -- motivo por el que existe utils/dateUtils.
          CASE
            WHEN asi.ultima IS NULL THEN NULL
            ELSE (DATE(?) - asi.ultima)
          END AS DiasSinVenir,
          -- Por qué está en la lista. Sirve para ordenar por urgencia y para
          -- que el mostrador sepa qué decir al llamar.
          CASE
            WHEN DATE(s.SuscripcionFechaFin) < DATE(?) THEN 'VENCIDA'
            WHEN p.PlanModalidad = 'CLASES'
                 AND COALESCE(s.SuscripcionClasesRestantes, 0) <= ?
                 AND DATE(s.SuscripcionFechaFin) > DATE(?)
              THEN 'CLASES'
            ELSE 'VENCE'
          END AS Motivo
        FROM (
          -- UNA fila por cliente: la de vigencia más lejana.
          --
          -- Antes esto era un INNER JOIN contra
          -- MAX(SuscripcionFechaFin) GROUP BY ClienteId, y emparejaba por
          -- igualdad de fecha. Si un cliente tenía DOS planes que terminaban
          -- el MISMO día, los dos empataban con el MAX y la persona salía
          -- DUPLICADA en la lista: dos llamadas para una sola conversación.
          -- DISTINCT ON con desempate por id garantiza una sola fila.
          --
          -- El filtro de canceladas/suspendidas va acá dentro a propósito: si
          -- se aplicara después, una cancelada con fecha lejana ganaría la
          -- selección y el cliente desaparecería del aviso aunque tuviera una
          -- vigente venciendo en días.
          --
          -- LIMITACIÓN: si el cliente tiene varios planes simultáneos, la fila
          -- muestra el saldo del más reciente, no la suma de todos. Para la
          -- lista de llamados alcanza (es una llamada); el detalle completo
          -- está en la ficha del socio.
          SELECT DISTINCT ON (ClienteId) *
          FROM suscripcion
          WHERE SuscripcionFechaFin IS NOT NULL
            AND SuscripcionEstado NOT IN ('C', 'S')
          ORDER BY ClienteId, SuscripcionFechaFin DESC, SuscripcionId DESC
        ) s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        LEFT JOIN LATERAL (
          -- Última asistencia del cliente. Usa el índice
          -- idx_asistencia_cliente_fecha (migración 017).
          SELECT MAX(AsistenciaFecha) AS ultima
          FROM asistencia WHERE ClienteId = s.ClienteId
        ) asi ON true
        WHERE s.SuscripcionFechaFin IS NOT NULL
          AND s.SuscripcionEstado NOT IN ('C', 'S')
          AND (
            -- Por fecha: dentro de la ventana.
            (DATE(s.SuscripcionFechaFin) >= DATE(?)
             AND DATE(s.SuscripcionFechaFin) <= DATE(?))
            -- O por cupo: plan de clases a punto de agotarse, aunque la fecha
            -- de fin esté lejos.
            OR (p.PlanModalidad = 'CLASES'
                AND COALESCE(s.SuscripcionClasesRestantes, 0) <= ?
                AND DATE(s.SuscripcionFechaFin) >= DATE(?))
          )
        ORDER BY s.SuscripcionFechaFin ASC
      `;
      const query = hasLimit ? `${baseSelect} LIMIT ?` : baseSelect;

      // Orden de los placeholders: los dos del CASE Motivo, los dos del rango
      // de fechas, y los dos de la rama por clases.
      // Orden de los placeholders, en el orden en que aparecen en el SQL:
      //   1) DiasSinVenir      -> hoy
      //   2) Motivo VENCIDA    -> hoy
      //   3) Motivo CLASES     -> umbral de clases
      //   4) Motivo CLASES     -> límite de la ventana
      //   5,6) rango de fechas -> desde, hasta
      //   7) rama por clases   -> umbral
      //   8) rama por clases   -> hoy
      const params = [
        hoyISO,
        hoyISO,
        clasesMin,
        fechaLimiteFormateada,
        fechaDesdeFormateada,
        fechaLimiteFormateada,
        clasesMin,
        hoyISO,
      ];
      if (hasLimit) params.push(limit);

      db.query(query, params, (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },

  /**
   * Reporte de suscripciones VIGENTES en un rango de fechas.
   *
   * "Vigente en el rango" = la vigencia de la suscripción SE SOLAPA con el
   * rango pedido, es decir `inicio <= hasta AND fin >= desde`. No alcanza con
   * mirar sólo la fecha de inicio (que es lo que hace el reporte de ocupación
   * mensual de reportes.controller): el socio que arrancó en marzo y sigue
   * pagando en junio está vigente en junio aunque no se haya inscrito ese
   * mes. Contar por fecha de inicio responde "cuántos entraron", no "cuántos
   * hay".
   *
   * Devuelve tres cosas, porque "cuántas suscripciones vigentes hay en este
   * rango" tiene dos lecturas legítimas y conviene mostrar las dos:
   *
   *   - `resumen`: cuántas suscripciones DISTINTAS estuvieron vigentes en
   *     algún momento del rango, más socios distintos, altas y bajas.
   *   - `serie`: cuántas había vigentes EN CADA FECHA. Es un stock, no un
   *     acumulado: cada punto es una foto de ese día y los puntos NO se suman
   *     entre sí. Es lo que contesta "cuántos socios activos tenía el 15 de
   *     mayo".
   *   - `detalle`: la lista, con el inicio y el fin de cada suscripción.
   *
   * SOBRE CANCELADAS Y SUSPENDIDAS: se excluyen por defecto, igual que en el
   * resto del módulo. La limitación de fondo es que `SuscripcionEstado` no
   * guarda CUÁNDO se canceló, así que una cancelada hoy desaparece también
   * del pasado, donde sí estuvo vigente, y eso subestima los rangos
   * históricos. `incluirCanceladas` permite ver el otro extremo (contarlas
   * siempre) y comparar; la cifra exacta necesitaría una fecha de baja en la
   * tabla, que hoy no existe.
   *
   * @param {string}  desde              'YYYY-MM-DD' inclusive.
   * @param {string}  hasta              'YYYY-MM-DD' inclusive.
   * @param {string}  paso               grano de la serie: 'dia'|'semana'|'mes'.
   * @param {number?} planId             filtrar por plan.
   * @param {boolean} incluirCanceladas  contar también C y S.
   * @param {number}  limiteDetalle      corte de filas del detalle.
   * @param {boolean} soloResumen        saltear serie, detalle y desglose por
   *                                     plan. Lo usa la comparación contra el
   *                                     período anterior, que sólo necesita
   *                                     los totales: correr las cinco
   *                                     consultas para descartar cuatro sería
   *                                     duplicar el costo del reporte.
   */
  getReporteVigentes: ({
    desde,
    hasta,
    paso = "dia",
    planId = null,
    incluirCanceladas = false,
    limiteDetalle = 500,
    soloResumen = false,
  }) => {
    const queryAsync = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params || [], (err, rows) =>
          err ? reject(err) : resolve(rows)
        );
      });

    // El paso se interpola en el SQL (un INTERVAL no admite placeholder sin
    // castear), así que sale de una tabla fija y nunca de la query string.
    const INTERVALOS = { dia: "1 day", semana: "1 week", mes: "1 month" };
    const intervalo = INTERVALOS[paso] || INTERVALOS.dia;

    const condEstado = incluirCanceladas
      ? ""
      : " AND s.SuscripcionEstado NOT IN ('C','S')";
    const condPlan = planId ? " AND s.PlanId = ?" : "";
    const paramsPlan = planId ? [planId] : [];

    // Solapamiento con el rango. Las fechas nulas quedan afuera: sin vigencia
    // definida no hay nada que contar.
    const whereSolape = `
      WHERE s.SuscripcionFechaInicio IS NOT NULL
        AND s.SuscripcionFechaFin IS NOT NULL
        AND DATE(s.SuscripcionFechaInicio) <= ?::date
        AND DATE(s.SuscripcionFechaFin) >= ?::date
        ${condEstado}${condPlan}
    `;

    const sqlResumen = `
      SELECT COUNT(*)::int AS suscripciones,
             COUNT(DISTINCT s.ClienteId)::int AS socios,
             COUNT(*) FILTER (
               WHERE DATE(s.SuscripcionFechaInicio) >= ?::date
             )::int AS altas,
             COUNT(*) FILTER (
               WHERE DATE(s.SuscripcionFechaFin) <= ?::date
             )::int AS bajas,
             COUNT(*) FILTER (
               WHERE DATE(s.SuscripcionFechaInicio) <= ?::date
                 AND DATE(s.SuscripcionFechaFin) >= ?::date
             )::int AS completas
      FROM suscripcion s
      ${whereSolape}
    `;

    // Desglose por plan. Responde "cuántos vigentes de cada plan" sin obligar
    // al usuario a cambiar el filtro una vez por plan y anotar los números a
    // mano. Va por PlanId y no por nombre: dos planes distintos pueden
    // haberse llamado igual a lo largo del tiempo.
    const sqlPorPlan = `
      -- s.PlanId va SIN alias a propósito: el adaptador de config/db renombra
      -- a PascalCase todo campo que venga de una columna real (mira el
      -- tableID de la metadata, no el alias), así que un 'AS planid' se
      -- pierde igual y el JS terminaba leyendo undefined. Las agregaciones de
      -- al lado sí conservan su alias porque son expresiones.
      SELECT s.PlanId,
             MAX(p.PlanNombre) AS plannombre,
             MAX(p.PlanPrecio) AS planprecio,
             COUNT(*)::int AS suscripciones,
             COUNT(DISTINCT s.ClienteId)::int AS socios
      FROM suscripcion s
      LEFT JOIN plan p ON s.PlanId = p.PlanId
      ${whereSolape}
      GROUP BY s.PlanId
      ORDER BY COUNT(*) DESC, MAX(p.PlanNombre) ASC
    `;

    // Foto puntual: cuántas vigentes en UNA fecha. Se usa para los extremos
    // del rango, que la serie no siempre incluye: con paso semanal o mensual
    // el último punto generado puede caer antes de `hasta`.
    const sqlPuntual = `
      SELECT COUNT(*)::int AS suscripciones,
             COUNT(DISTINCT s.ClienteId)::int AS socios
      FROM suscripcion s
      WHERE s.SuscripcionFechaInicio IS NOT NULL
        AND s.SuscripcionFechaFin IS NOT NULL
        AND DATE(s.SuscripcionFechaInicio) <= ?::date
        AND DATE(s.SuscripcionFechaFin) >= ?::date
        ${condEstado}${condPlan}
    `;

    // Serie: una fila por fecha generada. El LEFT JOIN es lo que hace que los
    // días sin nadie vigente aparezcan en cero en vez de desaparecer del
    // gráfico — un hueco se lee como "no hay dato", un cero se lee como "no
    // había nadie", que es lo que efectivamente pasó.
    const sqlSerie = `
      SELECT g.dia::date::text AS fecha,
             COUNT(s.SuscripcionId)::int AS suscripciones,
             COUNT(DISTINCT s.ClienteId)::int AS socios
      FROM generate_series(?::date, ?::date, INTERVAL '${intervalo}') AS g(dia)
      LEFT JOIN suscripcion s
             ON s.SuscripcionFechaInicio IS NOT NULL
            AND s.SuscripcionFechaFin IS NOT NULL
            AND DATE(s.SuscripcionFechaInicio) <= g.dia::date
            AND DATE(s.SuscripcionFechaFin) >= g.dia::date
            ${condEstado}${condPlan}
      GROUP BY g.dia
      ORDER BY g.dia
    `;

    // Detalle. `diasenrango` es cuántos días de esa suscripción caen DENTRO
    // del rango pedido, no su duración total: es lo que deja ver que un plan
    // anual aporta sólo los 30 días del mes consultado.
    const sqlDetalle = `
      SELECT s.SuscripcionId, s.ClienteId, s.PlanId,
             s.SuscripcionFechaInicio, s.SuscripcionFechaFin,
             s.SuscripcionEstado, s.SuscripcionClasesRestantes,
             c.ClienteNombre, c.ClienteApellido, c.ClienteRUC, c.ClienteTelefono,
             p.PlanNombre, p.PlanPrecio, p.PlanModalidad,
             COALESCE(pg.totalpagado, 0)::bigint AS totalpagado,
             (LEAST(DATE(s.SuscripcionFechaFin), ?::date)
              - GREATEST(DATE(s.SuscripcionFechaInicio), ?::date) + 1)::int
               AS diasenrango,
             -- Tramo EFECTIVO dentro del rango, recortado a los extremos.
             -- Para una suscripción del 5/5 al 5/6 consultada sobre junio
             -- entero da 01/06 → 05/06: es la respuesta literal a "hasta
             -- cuándo estuvo cubierto este socio en el período que pedí",
             -- que si no hay que deducir mentalmente cruzando la fecha de fin
             -- con el rango.
             GREATEST(DATE(s.SuscripcionFechaInicio), ?::date)::text
               AS cubredesde,
             LEAST(DATE(s.SuscripcionFechaFin), ?::date)::text AS cubrehasta,
             (DATE(s.SuscripcionFechaFin)
              - DATE(s.SuscripcionFechaInicio) + 1)::int AS diastotales
      FROM suscripcion s
      LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
      LEFT JOIN plan p ON s.PlanId = p.PlanId
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
        FROM pago WHERE SuscripcionId = s.SuscripcionId
      ) pg ON true
      ${whereSolape}
      ORDER BY DATE(s.SuscripcionFechaFin) ASC,
               c.ClienteApellido ASC, c.ClienteNombre ASC,
               s.SuscripcionId ASC
      LIMIT ?
    `;

    // Pedimos una fila de más que el límite: si vuelve, sabemos que el
    // detalle quedó cortado y el frontend lo avisa, en vez de mostrar una
    // lista incompleta como si fuera todo.
    const limitePedido = Math.max(1, Number(limiteDetalle) || 500);

    // `soloResumen` reemplaza las tres consultas pesadas por promesas vacías
    // en vez de sacarlas del Promise.all: así el destructuring de abajo sigue
    // teniendo la misma forma y no hay dos caminos que mantener.
    const vacio = Promise.resolve([]);

    return Promise.all([
      queryAsync(sqlResumen, [
        desde, // altas: inicio >= desde
        hasta, // bajas: fin <= hasta
        desde, // completas: inicio <= desde
        hasta, // completas: fin >= hasta
        hasta, // solape: inicio <= hasta
        desde, // solape: fin >= desde
        ...paramsPlan,
      ]),
      soloResumen ? vacio : queryAsync(sqlSerie, [desde, hasta, ...paramsPlan]),
      soloResumen
        ? vacio
        : queryAsync(sqlDetalle, [
            hasta, // diasenrango: LEAST(fin, hasta)
            desde, // diasenrango: GREATEST(inicio, desde)
            desde, // cubredesde
            hasta, // cubrehasta
            hasta, // solape: inicio <= hasta
            desde, // solape: fin >= desde
            ...paramsPlan,
            limitePedido + 1,
          ]),
      queryAsync(sqlPuntual, [desde, desde, ...paramsPlan]),
      queryAsync(sqlPuntual, [hasta, hasta, ...paramsPlan]),
      soloResumen
        ? vacio
        : queryAsync(sqlPorPlan, [hasta, desde, ...paramsPlan]),
    ]).then(([resumenRows, serieRows, detalleRows, alInicio, alFin, planRows]) => {
      const r = resumenRows[0] || {};
      const truncado = detalleRows.length > limitePedido;
      const filas = truncado ? detalleRows.slice(0, limitePedido) : detalleRows;

      const detalle = filas.map((f) => {
        const precio = Number(f.PlanPrecio || 0);
        const pagado = Number(f.totalpagado || 0);
        return {
          suscripcionId: f.SuscripcionId,
          clienteId: f.ClienteId,
          socio:
            [f.ClienteNombre, f.ClienteApellido].filter(Boolean).join(" ") ||
            `Cliente ${f.ClienteId}`,
          ruc: f.ClienteRUC || "",
          telefono: f.ClienteTelefono || "",
          planId: f.PlanId,
          plan: f.PlanNombre || "",
          planPrecio: precio,
          modalidad: f.PlanModalidad || "MENSUAL",
          clasesRestantes: Number(f.SuscripcionClasesRestantes || 0),
          fechaInicio: String(f.SuscripcionFechaInicio).split("T")[0],
          fechaFin: String(f.SuscripcionFechaFin).split("T")[0],
          // Vigencia real de la suscripción vs. tramo que cae en el rango
          // consultado. Son distintos justamente cuando la suscripción cruza
          // un extremo, que es el caso interesante del reporte.
          cubreDesde: String(f.cubredesde).split("T")[0],
          cubreHasta: String(f.cubrehasta).split("T")[0],
          diasEnRango: Number(f.diasenrango || 0),
          diasTotales: Number(f.diastotales || 0),
          // Estado a HOY, no dentro del rango: C y S son manuales y se
          // respetan; el resto se recalcula por fechas como en todo el
          // módulo, para que la columna diga lo mismo que la pantalla de
          // Suscripciones.
          estado:
            f.SuscripcionEstado === "C" || f.SuscripcionEstado === "S"
              ? f.SuscripcionEstado
              : calcularEstadoPorFechas(
                  f.SuscripcionFechaInicio,
                  f.SuscripcionFechaFin
                ),
          estadoPago: precio === 0 || pagado >= precio ? "PAGADA" : "PENDIENTE",
          totalPagado: pagado,
          saldoPendiente: Math.max(precio - pagado, 0),
        };
      });

      return {
        resumen: {
          suscripciones: Number(r.suscripciones || 0),
          socios: Number(r.socios || 0),
          // Arrancaron dentro del rango: las altas del período.
          altas: Number(r.altas || 0),
          // Terminan dentro del rango: son las que hay que renovar.
          bajas: Number(r.bajas || 0),
          // Cubren el rango entero, de punta a punta.
          completas: Number(r.completas || 0),
          vigentesAlInicio: Number(alInicio[0]?.suscripciones || 0),
          sociosAlInicio: Number(alInicio[0]?.socios || 0),
          vigentesAlFin: Number(alFin[0]?.suscripciones || 0),
          sociosAlFin: Number(alFin[0]?.socios || 0),
        },
        serie: serieRows.map((s) => ({
          fecha: String(s.fecha).split("T")[0],
          suscripciones: Number(s.suscripciones || 0),
          socios: Number(s.socios || 0),
        })),
        porPlan: planRows.map((p) => ({
          planId: p.PlanId,
          plan: p.plannombre || `Plan ${p.PlanId}`,
          planPrecio: Number(p.planprecio || 0),
          suscripciones: Number(p.suscripciones || 0),
          socios: Number(p.socios || 0),
        })),
        detalle,
        detalleTruncado: truncado,
        limiteDetalle: limitePedido,
      };
    });
  },
};

module.exports = Suscripcion;
