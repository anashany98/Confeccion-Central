import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const L = require("../../app/static/logic.js");
const { num, round, fmt, parseDimension, calcRowFor, splitExcelText, detectExcelColumns, statusFromValue, FIXED_CLOSURE_ADD } = L;

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

test("calcRow reproduce el caso real del cuadrante (1101: 4,75×2,81, 1,50, 2 hojas)", () => {
  // fabricWidth amplio para que el caso no dispare el warning de ancho de tela.
  const c = calcRowFor(row({ width: "4,75", height: "2,81", gather: "1,50", sheets: 2 }), { ...project(), fabricWidth: 4 });
  assert.equal(c.width, 4.75);
  assert.equal(c.height, 2.81);
  assert.equal(c.gather, 1.5);
  assert.equal(c.sheets, 2);
  // Medida de tela = ancho × fruncido.
  assert.equal(round(c.meters, 4), 7.125);
  assert.equal(round(c.metersPerSheet, 4), 3.5625); // m/hoja -> 3,56
  // Alto de corte = altura - descuento, redondeado a 0,03.
  assert.equal(c.finalHeight, round(2.81 - 0.02, 4));
  assert.equal(c.cutHeight, 2.79);
  // Ancho de corte = (ancho redondeado a 0,05 / hojas) × fruncido.
  assert.equal(round(c.cutWidth, 2), 3.56);
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

test("calcRow avisa si el ancho de corte excede el ancho de tela", () => {
  const c = calcRowFor(row({ width: "3,5", gather: "2,5", sheets: 1 }), project());
  assert.equal(c.ok, false);
  assert.ok(c.issues.some((i) => i.includes("excede el ancho de tela")));
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

test("statusFromValue mapea texto a estado de producción", () => {
  assert.equal(statusFromValue("Instalada"), "installed");
  assert.equal(statusFromValue("CONFECCIONADA"), "sewn");
  assert.equal(statusFromValue("cortada"), "cut");
  assert.equal(statusFromValue("Medida revisada"), "measured");
  assert.equal(statusFromValue("cualquier cosa"), "");
});
