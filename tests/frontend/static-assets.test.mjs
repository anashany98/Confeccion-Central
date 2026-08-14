import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const central = fs.readFileSync("app/static/central.js", "utf8");
const app = fs.readFileSync("app/static/app.js", "utf8");
const sentry = fs.readFileSync("app/static/sentry.js", "utf8");
const logic = fs.readFileSync("app/static/logic.js", "utf8");
const index = fs.readFileSync("app/static/index.html", "utf8");
const serviceWorker = fs.readFileSync("app/static/sw.js", "utf8");

test("las mutaciones incluyen protección CSRF", () => {
  assert.match(central, /X-CSRF-Token/);
  assert.match(central, /csrf_token/);
});

test("las obras no se persisten en localStorage bajo claves sensibles", () => {
  assert.doesNotMatch(app, /localStorage\.setItem\(JOBS_KEY/);
  assert.doesNotMatch(app, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(app, /clearSensitiveState/);
});

test("Excel se sirve localmente y entra en la caché PWA", () => {
  assert.match(index, /\/static\/vendor\/xlsx\.full\.min\.js/);
  assert.match(serviceWorker, /\/static\/vendor\/xlsx\.full\.min\.js/);
  assert.doesNotMatch(index, /cdn\.jsdelivr\.net/);
});

test("las respuestas API no se almacenan en la caché", () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\(["']\/api\/["']\)/);
});

test("los avisos de ancho/alto de corte vs ancho de tela llegan a la revisión visual", () => {
  assert.match(app, /Ancho de corte .*excede el ancho de tela/);
  assert.match(app, /Ancho de corte .*a menos de 10 cm del ancho de tela/);
  assert.match(app, /Alto de corte .*no cabe en el ancho de tela/);
  assert.match(app, /t\.includes\('ancho de tela'\)/);
});

test("el modal de trabajos separa los propios de los de compañeros", () => {
  assert.match(index, /data-job-scope="mine"/);
  assert.match(index, /data-job-scope="others"/);
  assert.match(index, /Mis trabajos/);
  assert.match(index, /Compañeros/);
  assert.match(app, /setOthersJobs/);
  assert.match(central, /scope=others/);
  assert.match(central, /isReadOnlyJob/);
});

test("las etiquetas de paños llevan código de barras de trazabilidad para coser", () => {
  assert.match(app, /code128Pattern/);
  assert.match(app, /traceCode/);
  assert.match(index, /label-barcode-wrap/);
  assert.match(index, /label-trace/);
  assert.match(app, /HOJA \$\{sheet\}\/\$\{c\.sheets\}/);
});

test("hay modo de impresión a etiqueta de 40 mm (Zebra) con una por página", () => {
  assert.match(app, /printLabelsZebra/);
  assert.match(index, /@page zebra-40x60\{size:40mm 60mm/);
  assert.match(index, /body\.zebra-print/);
  assert.match(index, /page-break-after:always/);
});

test("el tamaño de etiqueta Zebra es configurable en el toolbar", () => {
  assert.match(index, /id="zebraLabelSize"/);
  assert.match(index, /@page zebra-40x50\{size:40mm 50mm/);
  assert.match(index, /@page zebra-40x80\{size:40mm 80mm/);
  assert.match(app, /state\.zebraLabelSize=e\.target\.value/);
});

test("las etiquetas se generan también en ZPL nativo (formato Zebra)", () => {
  assert.match(index, /id="zplBtn"/);
  assert.match(app, /zebraZpl/);
  assert.match(index, /id="zplOutput"/);
  assert.match(index, /send_zpl\.py/);
  assert.match(index, /Descargar \.prn/);
});

test("hay envío directo a la Zebra mediante agente local (un clic)", () => {
  assert.match(index, /id="sendZebraBtn"/);
  assert.match(app, /sendToZebra/);
  assert.match(app, /127\.0\.0\.1:8765/);
  assert.match(index, /zebra_agent\.py/);
});

test("el añadido de cierre es un desplegable de 0,06 u 0,15 m enlazado al proyecto", () => {
  assert.match(index, /id="p-closureAdd"/);
  assert.match(index, /option value="0\.06"/);
  assert.match(index, /option value="0\.15"/);
  assert.match(app, /'p-closureAdd':'closureAdd'/);
});

test("los scripts externos son JavaScript válido", () => {
  for (const script of [app, sentry, central, logic]) {
    assert.doesNotThrow(() => new Function(script));
  }
});
