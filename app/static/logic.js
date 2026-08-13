/* Núcleo de cálculo de Confección Central.
 * Módulo UMD: en el navegador inyecta las funciones como globales (las usa el
 * script principal de index.html) y en Node se exporta para la suite de tests
 * (tests/frontend/logic.test.mjs). Todo lo que vive aquí es puro: no lee
 * `state`, no toca el DOM. La app envuelve `calcRowFor` pasando `state.project`.
 */
(function (global, factory) {
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(global, factory());
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Añadido para cierre por defecto 0,06 m; el taller puede elegir 0,06 u 0,15 m.
  const FIXED_CLOSURE_ADD = 0.06;

  const num = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const raw = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
    const m = raw.match(/-?\d+(?:\.\d+)?/);
    const n = m ? parseFloat(m[0]) : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  const round = (v, d = 2) => Math.round((num(v) + Number.EPSILON) * 10 ** d) / 10 ** d;
  const fmt = (v, d = 2) =>
    num(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
  const normalizeText = (v) =>
    String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const normalizeHeader = (v) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[º°ª]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  function parseDimension(value, header = "") {
    const raw = String(value ?? "").trim();
    if (raw === "") return { value: "", converted: false, source: "" };
    let n = num(raw);
    if (!Number.isFinite(n)) return { value: "", converted: false, source: "" };
    const h = normalizeText(header + " " + raw);
    let source = "m",
      converted = false;
    if (/\bmm\b|milimet/.test(h)) {
      n /= 1000;
      source = "mm";
      converted = true;
    } else if (/\bcm\b|centimet/.test(h)) {
      n /= 100;
      source = "cm";
      converted = true;
    } else if (Math.abs(n) > 20 && Math.abs(n) <= 1000) {
      n /= 100;
      source = "cm estimados";
      converted = true;
    } else if (Math.abs(n) > 1000 && Math.abs(n) <= 10000) {
      n /= 1000;
      source = "mm estimados";
      converted = true;
    }
    return { value: round(n, 4), converted, source };
  }

  // Versión pura de calcRow: el proyecto se pasa explícito para poder testearla.
  function calcRowFor(r, project) {
    const p = project || {};
    const issues = [];
    // Detecta entradas no numéricas en los crudos (no en los saneados).
    const looksNumeric = (v) => v === "" || v == null || /-?\d/.test(String(v));
    if (!looksNumeric(r.width)) issues.push(`Ancho "${r.width}" no es numérico`);
    if (!looksNumeric(r.height)) issues.push(`Altura "${r.height}" no es numérica`);
    if (!looksNumeric(r.gather)) issues.push(`Fruncido "${r.gather}" no es numérico`);
    if (!looksNumeric(r.sheets)) issues.push(`Hojas "${r.sheets}" no es numérico`);

    // Sanitiza: nunca devuelve NaN ni negativos para los cálculos.
    const width = Math.max(0, num(r.width));
    const height = Math.max(0, num(r.height));
    const gather = Math.max(0, num(r.gather));
    const sheets = Math.max(1, Math.round(num(r.sheets) || p.mode || 1));
    const hem = Math.max(0, num(r.hem ?? p.hem));

    const measure = width * gather,
      measurePerSheet = sheets ? measure / sheets : measure,
      meters = measure;
    const fabricPrice = num(p.priceFabric),
      confectionPrice = num(p.priceConfection),
      installationCost = num(p.priceInstallation);
    const fabricCost = meters * fabricPrice,
      confectionCost = meters * confectionPrice,
      base = fabricCost + confectionCost + installationCost,
      benefit = base * (num(p.margin) / 100),
      total = base + benefit;
    const finalHeight = Math.max(0, height - num(p.heightDiscount)),
      standardWidth = Math.round(width / 0.05) * 0.05,
      cutWidth = (standardWidth / sheets) * gather,
      cutHeight = Math.round(finalHeight / 0.03) * 0.03;
    const panelWidth = width / sheets + (num(p.closureAdd) || FIXED_CLOSURE_ADD),
      metersPerSheet = sheets ? meters / sheets : meters;

    // Validaciones de lógica de negocio (no son errores fatales: warnings).
    const fabricWidth = num(p.fabricWidth);
    // Margen de seguridad de 10 cm: avisa antes de llegar al límite del ancho de tela.
    if (fabricWidth > 0 && cutWidth > fabricWidth - 0.1) {
      issues.push(cutWidth > fabricWidth
        ? `Ancho de corte ${fmt(cutWidth)} m excede el ancho de tela (${fmt(fabricWidth)} m)`
        : `Ancho de corte ${fmt(cutWidth)} m a menos de 10 cm del ancho de tela (${fmt(fabricWidth)} m)`);
    }
    if (fabricWidth > 0 && cutHeight > 0 && cutHeight > fabricWidth) {
      issues.push(`Alto de corte ${fmt(cutHeight)} m no cabe en el ancho de tela (${fmt(fabricWidth)} m)`);
    }
    if (cutHeight > 0 && cutHeight < 0.4) {
      issues.push(`Alto de corte muy corto: ${fmt(cutHeight)} m (mínimo recomendado 0,4 m)`);
    }
    if (cutHeight > 4) {
      issues.push(`Alto de corte ${fmt(cutHeight)} m excede un rollo habitual (4 m)`);
    }
    if (meters > 50) {
      issues.push(`Metros totales muy altos: ${fmt(meters)} m — revisar medidas`);
    }
    if (hem > 1) {
      issues.push(`Bajo/cresta ${fmt(hem)} m inusualmente alto (> 1 m)`);
    }

    return {
      ok: issues.length === 0,
      issues,
      width,
      height,
      gather,
      sheets,
      measure,
      measurePerSheet,
      meters,
      fabricPrice,
      confectionPrice,
      installationCost,
      fabricCost,
      confectionCost,
      base,
      benefit,
      total,
      finalHeight,
      standardWidth,
      cutWidth,
      cutHeight,
      panelWidth,
      metersPerSheet,
    };
  }

  function splitExcelText(raw) {
    const lines = String(raw || "").replace(/\r/g, "").split("\n");
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    if (!lines.length) return [];
    const sample = lines.slice(0, 4).join("\n"),
      delimiter = sample.includes("\t") ? "\t" : sample.includes(";") ? ";" : ",";
    if (delimiter === "\t") return lines.map((line) => line.split("\t"));
    const parseLine = (line) => {
      const out = [];
      let cur = "",
        quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (quoted && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else quoted = !quoted;
        } else if (ch === delimiter && !quoted) {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
      out.push(cur);
      return out;
    };
    return lines.map(parseLine);
  }

  function detectExcelColumns(header) {
    const h = header.map(normalizeHeader),
      find = (tests) => h.findIndex((x) => tests.some((t) => x.includes(t)));
    const map = {
      room: find(["habitacion", "habitaciones", "dormitorio", "estancia", "room", "numero habitacion", "n habitacion"]),
      width: find(["ancho hueco", "anchura hueco", "ancho", "anchura", "width"]),
      height: find(["altura", "alto", "height"]),
      gather: find(["fruncido", "factor fruncido", "factor", "fullness"]),
      hem: find(["bajo y cresta", "bajo cresta", "bajo", "cresta", "dobladillo"]),
      sheets: find(["numero hojas", "n hojas", "hojas", "num hojas", "panos", "panes", "paneles"]),
      notes: find(["observaciones", "observacion", "notas", "nota", "comentarios", "comentario"]),
      status: find(["estado", "status", "produccion"]),
    };
    return { map, matches: Object.values(map).filter((i) => i >= 0).length, normalized: h };
  }

  function statusFromValue(v) {
    const s = normalizeText(v);
    if (s.includes("instal")) return "installed";
    if (s.includes("confe") || s.includes("cosid")) return "sewn";
    if (s.includes("cort")) return "cut";
    if (s.includes("medid") || s.includes("revis")) return "measured";
    return "";
  }

  // Code 128 (subconjunto B): anchos de cada elemento (barra/espacio) por valor.
  // Cada símbolo ocupa 11 módulos salvo el Stop (13). Índice = valor del símbolo.
  const CODE128_PATTERNS = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");

  // Genera el patrón de módulos de un código de barras Code 128B para texto imprimible.
  // Devuelve una cadena de dígitos (ancho de cada elemento, alternando barra/espacio)
  // o null si no queda ningún carácter válido (ASCII 32-126).
  function code128Pattern(text) {
    const chars = String(text ?? "").split("").filter((ch) => {
      const c = ch.codePointAt(0);
      return c >= 32 && c <= 126;
    });
    if (!chars.length) return null;
    const symbols = [104]; // Start B
    let checksum = 104;
    for (let i = 0; i < chars.length; i++) {
      const value = chars[i].charCodeAt(0) - 32;
      symbols.push(value);
      checksum += value * (i + 1);
    }
    symbols.push(checksum % 103, 106); // dígito de control + Stop
    return symbols.map((v) => CODE128_PATTERNS[v]).join("");
  }

  return {
    FIXED_CLOSURE_ADD,
    num,
    round,
    fmt,
    normalizeText,
    normalizeHeader,
    parseDimension,
    calcRowFor,
    splitExcelText,
    detectExcelColumns,
    statusFromValue,
    code128Pattern,
  };
});
