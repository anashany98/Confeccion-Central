import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const L = require("../../app/static/logic.js");
const { num, round, fmt, parseDimension, calcRowFor, splitExcelText, detectExcelColumns, statusFromValue, FIXED_CLOSURE_ADD, code128Pattern, zebraZpl } = L;

// Proyecto por defecto de la app (misma forma que defaultState().project).
const project = () => ({ mode: 2, fabricWidth: 2.8, heightDiscount: 0.02, hem: 0.25, gather: 2, priceFabric: 0, priceConfection: 0, priceInstallation: 0, margin: 0 });
const row = (over = {}) => ({ room: "1101", width: "", height: "", gather: 2, hem: 0.25, sheets: 2, notes: "", ...over });

test("num acepta formato europeo, espacios y basura", () => {
  assert.equal(num("3,56"), 3.56);
  assert.equal(num(" 4,75 m "), 4.75);
  assert.equal(num("1.234,5"), 1.234); // el regex extrae el primer número: "1.234"
  assert.equal(num("abc"), 0);
  assert.equal(num(""), 0);
  assert.equal(num(NaN), 0);
  assert.equal(num(2.5), 2.5);
});

test("round y fmt con separador español", () => {
  assert.equal(round(3.5625, 2), 3.56);
  assert.equal(round(2.785, 2), 2.79);
  assert.equal(fmt(7.125), "7,13");
  assert.equal(fmt(3.5625), "3,56");
  // El separador de miles depende del ICU del entorno; solo aseguramos la coma decimal.
  assert.match(fmt(1234.5, 1), /,5$/);
});

test("parseDimension: metros explícitos y vacíos", () => {
  assert.deepEqual(parseDimension(""), { value: "", converted: false, source: "" });
  assert.deepEqual(parseDimension("2,80"), { value: 2.8, converted: false, source: "m" });
  assert.deepEqual(parseDimension("2.8"), { value: 2.8, converted: false, source: "m" });
});

test("parseDimension: conversión por encabezado (cm/mm)", () => {
  assert.deepEqual(parseDimension("280", "Altura (cm)"), { value: 2.8, converted: true, source: "cm" });
  assert.deepEqual(parseDimension("2800", "Ancho en mm"), { value: 2.8, converted: true, source: "mm" });
});

test("parseDimension: conversión por magnitud (cm/mm estimados)", () => {
  assert.deepEqual(parseDimension("280"), { value: 2.8, converted: true, source: "cm estimados" });
  assert.deepEqual(parseDimension("2800"), { value: 2.8, converted: true, source: "mm estimados" });
  // 20 o menos se considera ya en metros: sin conversión.
  assert.deepEqual(parseDimension("2,8"), { value: 2.8, converted: false, source: "m" });
});

test("calcRow usa el añadido de cierre del proyecto (0,06 u 0,15 m)", () => {
  const c15 = calcRowFor(row({ width: "4,75", gather: "1,5", sheets: 2 }), { ...project(), closureAdd: 0.15 });
  assert.equal(round(c15.panelWidth, 4), round(4.75 / 2 + 0.15, 4));
  // El cierre es una tira plana: NO se multiplica por el fruncido.
  assert.equal(round(c15.metersPerSheet, 4), round((4.75 / 2) * 1.5 + 0.15, 4));
  assert.equal(round(c15.meters, 4), round(4.75 * 1.5 + 0.15 * 2, 4));
  // Desglose: la base es ancho × fruncido y la diferencia es el cierre plano.
  assert.equal(round(c15.metersBase, 4), round(4.75 * 1.5, 4));
  assert.equal(round(c15.meters - c15.metersBase, 4), round(0.15 * 2, 4));
  // El ancho de corte del cuadrante: cuerpo fruncido + cierre plano.
  assert.equal(round(c15.cutWidth, 4), round((4.75 / 2) * 1.5 + 0.15, 4));
  // Hoja de confección SIN fruncido: ancho terminado y metros a la medida final.
  assert.equal(round(c15.sheetWidth, 4), round(4.75 / 2 + 0.15, 4));
  assert.equal(round(c15.sheetMeters, 4), round(4.75 + 0.15 * 2, 4));
  assert.equal(round(c15.sheetMetersPerSheet, 4), round(4.75 / 2 + 0.15, 4));
  // Sin closureAdd (proyectos antiguos) cae al valor por defecto 0,06.
  const c06 = calcRowFor(row({ width: "4,75", gather: "1,5", sheets: 2 }), project());
  assert.equal(round(c06.panelWidth, 4), round(4.75 / 2 + FIXED_CLOSURE_ADD, 4));
  assert.equal(round(c06.meters, 4), round(4.75 * 1.5 + FIXED_CLOSURE_ADD * 2, 4));
  // 0,15 m suma más que 0,06 m en el total.
  assert.ok(c15.meters > c06.meters);
});

test("calcRow reproduce el caso real del cuadrante (1101: 4,75×2,81, 1,50, 2 hojas)", () => {
  // fabricWidth amplio para que el caso no dispare el warning de ancho de tela.
  const c = calcRowFor(row({ width: "4,75", height: "2,81", gather: "1,50", sheets: 2 }), { ...project(), fabricWidth: 4 });
  assert.equal(c.width, 4.75);
  assert.equal(c.height, 2.81);
  assert.equal(c.gather, 1.5);
  assert.equal(c.sheets, 2);
  // Metros de tela = cuerpo fruncido + cierre plano (no se frunce).
  assert.equal(round(c.meters, 4), 7.245); // 4,75 × 1,50 + 0,06 × 2
  assert.equal(round(c.metersBase, 4), 7.125); // sin cierre: 4,75 × 1,50
  assert.equal(round(c.metersPerSheet, 4), 3.6225); // m/hoja -> 3,62
  // Alto de corte = altura - descuento, redondeado a 0,03.
  assert.equal(c.finalHeight, round(2.81 - 0.02, 4));
  assert.equal(c.cutHeight, 2.79);
  // Ancho de corte (cuadrante) = cuerpo con fruncido + cierre plano.
  assert.equal(round(c.cutWidth, 2), 3.62);
  // Hoja de confección sin fruncido: ancho terminado y metros a medida final.
  assert.equal(round(c.sheetWidth, 4), round(4.75 / 2 + FIXED_CLOSURE_ADD, 4));
  assert.equal(round(c.sheetMeters, 4), round(4.75 + FIXED_CLOSURE_ADD * 2, 4));
  // Panel = ancho/hojas + cierre fijo.
  assert.equal(round(c.panelWidth, 4), round(4.75 / 2 + FIXED_CLOSURE_ADD, 4));
  assert.equal(c.ok, true, "sin warnings: " + c.issues.join(" | "));
});

test("calcRow sanea entradas: sin NaN ni negativos", () => {
  const c = calcRowFor(row({ width: "abc", height: "", gather: "", sheets: "" }), project());
  assert.equal(c.width, 0);
  assert.equal(c.height, 0);
  assert.equal(c.sheets, 2); // cae al modo por defecto del proyecto
  assert.ok(Number.isFinite(c.meters));
  assert.equal(c.ok, false);
  assert.ok(c.issues.some((i) => i.includes("no es numérico")));
});

test("calcRow avisa si el alto de corte excede el ancho de tela", () => {
  // El ancho del rollo limita el ALTO de hueco: 3,00 no cabe en un rollo de 2,80.
  const c = calcRowFor(row({ width: "1,5", height: "3", gather: "1,5", sheets: 1 }), project());
  assert.equal(c.ok, false);
  assert.ok(c.issues.some((i) => i.includes("Alto de corte") && i.includes("excede el ancho de tela")));
});

test("calcRow avisa con margen de 10 cm antes del límite del ancho de tela (por alto)", () => {
  // Alto de corte 2,73 con tela de 2,80: dentro del margen -> aviso sin llegar al límite.
  const cerca = calcRowFor(row({ width: "1,5", height: "2,75", gather: "1", sheets: 1 }), project());
  assert.ok(cerca.issues.some((i) => i.includes("a menos de 10 cm del ancho de tela")));
  // Alto de corte 2,58: fuera del margen -> sin aviso.
  const lejos = calcRowFor(row({ width: "1,5", height: "2,6", gather: "1", sheets: 1 }), project());
  assert.ok(!lejos.issues.some((i) => i.includes("ancho de tela")));
});

test("el ancho de corte ya no dispara el aviso de tela (solo el alto de hueco)", () => {
  // Un ancho grande (2,70 × 2,50 de fruncido) no avisa aunque el ancho de corte
  // supere el rollo: el ancho del rollo limita el alto, no el ancho del hueco.
  const ancho = calcRowFor(row({ width: "2,7", height: "2,2", gather: "2,5", sheets: 1 }), project());
  assert.ok(!ancho.issues.some((i) => i.includes("ancho de tela")));
});

test("calcRow avisa con alto de corte fuera de rango", () => {
  const corto = calcRowFor(row({ width: "1", height: "0,3" }), project());
  assert.ok(corto.issues.some((i) => i.includes("muy corto")));
  const largo = calcRowFor(row({ width: "1", height: "5" }), project());
  assert.ok(largo.issues.some((i) => i.includes("rollo habitual")));
});



test("splitExcelText: tabulaciones, punto y coma y comillas", () => {
  assert.deepEqual(splitExcelText("1101\t4,75\t2,81\n1102\t3,1\t2,2\n"), [
    ["1101", "4,75", "2,81"],
    ["1102", "3,1", "2,2"],
  ]);
  assert.deepEqual(splitExcelText('Habitación;Ancho;"Nota, con coma"\n1101;2;"a""b"'), [
    ["Habitación", "Ancho", "Nota, con coma"],
    ["1101", "2", 'a"b'],
  ]);
});

test("detectExcelColumns reconoce encabezados españoles con tildes y nº", () => {
  const d = detectExcelColumns(["Nº Habitación", "Ancho hueco (m)", "Altura (m)", "Fruncido", "Bajo y cresta", "Nº hojas", "Observaciones"]);
  assert.equal(d.map.room, 0);
  assert.equal(d.map.width, 1);
  assert.equal(d.map.height, 2);
  assert.equal(d.map.gather, 3);
  assert.equal(d.map.hem, 4);
  assert.equal(d.map.sheets, 5);
  assert.equal(d.map.notes, 6);
  assert.ok(d.matches >= 6);
});

test("detectExcelColumns reconoce Bloque y Planta (México / Caribe)", () => {
  const d = detectExcelColumns(["Bloque", "Planta", "Habitación", "Ancho", "Alto", "Observaciones"]);
  assert.equal(d.map.block, 0);
  assert.equal(d.map.floor, 1);
  assert.equal(d.map.room, 2);
  assert.equal(d.map.width, 3);
  assert.equal(d.map.height, 4);
  const sinHabitacion = detectExcelColumns(["Torre", "Nivel", "Ancho hueco", "Altura"]);
  assert.equal(sinHabitacion.map.block, 0);
  assert.equal(sinHabitacion.map.floor, 1);
  assert.equal(sinHabitacion.map.room, -1);
  // El encabezado clásico no debe confundir bloque/planta con la habitación.
  const clasico = detectExcelColumns(["Nº Habitación", "Ancho hueco (m)", "Altura (m)", "Fruncido", "Bajo y cresta", "Nº hojas", "Observaciones"]);
  assert.equal(clasico.map.block, -1);
  assert.equal(clasico.map.floor, -1);
  assert.equal(clasico.map.room, 0);
});

test("code128Pattern genera Code 128B con Start B, dígito de control y Stop", () => {
  // "AB": valores 33 y 34; checksum = (104 + 33·1 + 34·2) mod 103 = 102.
  assert.equal(
    code128Pattern("AB"),
    "211214" + "111323" + "131123" + "411131" + "2331112"
  );
  // Texto sin caracteres imprimibles no genera código.
  assert.equal(code128Pattern(""), null);
  assert.equal(code128Pattern(null), null);
  // Un código de trazabilidad real: empieza por Start B y termina por Stop.
  const p = code128Pattern("CC-1A2B3C-1101-H2");
  assert.ok(p.startsWith("211214"));
  assert.ok(p.endsWith("2331112"));
  assert.match(p, /^[1-4]+$/);
});

test("zebraZpl genera ZPL nativo de etiqueta con barras Code 128", () => {
  const z = zebraZpl(
    {
      hotel: "Hotel Prueba",
      corte: "CORTE C-01",
      room: "HAB. 101",
      size: "2,40 × 2,67 m",
      sheet: "HOJA 1/2 · IZQ",
      meta1: "Hueco 2,40 × 2,68 m · Fruncido 2,00",
      meta2: "Tela oscurante · 04/08/2026",
      code: "CC-4F4953-101-H1",
    },
    40,
    60
  );
  assert.ok(z.startsWith("^XA"));
  assert.ok(z.endsWith("^XZ"));
  assert.match(z, /\^PW320/); // 40 mm a 203 dpi
  assert.match(z, /\^LL480/); // 60 mm a 203 dpi
  assert.match(z, /\^MTT/); // transferencia térmica
  assert.match(z, /\^CI28/);
  assert.match(z, /\^BCN,\d+,N,N,N/); // código de barras sin HRI (texto propio debajo)
  assert.match(z, /\^FDCC-4F4953-101-H1\^FS/);
  // Caracteres especiales de ZPL escapados.
  const esc = zebraZpl({ ...{ hotel: "Obra^Hotel~1", corte: "", room: "", size: "", sheet: "", meta1: "", meta2: "", code: "A" } }, 40, 60);
  assert.match(esc, /Obra\\\^Hotel\\~1/);
  // Otro tamaño de etiqueta: 50×60 mm.
  const z50 = zebraZpl({ hotel: "", corte: "", room: "", size: "", sheet: "", meta1: "", meta2: "", code: "A" }, 50, 60);
  assert.match(z50, /\^PW400/);
});

test("statusFromValue mapea texto a estado de producción", () => {
  assert.equal(statusFromValue("Instalada"), "installed");
  assert.equal(statusFromValue("CONFECCIONADA"), "sewn");
  assert.equal(statusFromValue("cortada"), "cut");
  assert.equal(statusFromValue("Medida revisada"), "measured");
  assert.equal(statusFromValue("cualquier cosa"), "");
});
