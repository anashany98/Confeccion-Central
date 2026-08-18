# Cálculos de la aplicación

Referencia de todas las fórmulas de Confección Central: qué se calcula, con qué
fórmula, un ejemplo numérico y dónde se muestra en la interfaz.

## Convenciones y redondeos

- **`num(v)`**: interpreta el valor como número en formato europeo (coma
  decimal, p. ej. `4,75`), ignora espacios y texto sobrante. Si no se puede
  interpretar, devuelve `0`.
- **`fmt(v)`**: muestra con **2 decimales** y coma española (p. ej. `7,31`).
  Los importes (`money`) se muestran en euros con 2 decimales.
- **Redondeo del ancho al corte**: al múltiplo de **0,05 m** más cercano
  (`round(ancho / 0.05) * 0.05`).
- **Redondeo del alto al corte**: al múltiplo de **0,03 m** más cercano
  (`round(alto / 0.03) * 0.03`).
- Los totales se suman con el **valor exacto** (sin redondear por fila) y se
  redondean al mostrar.
- Entradas saneadas por fila: ancho, alto y fruncido nunca negativos; hojas
  mínimo 1 (cae al modo del proyecto si está vacío).

Valores por defecto del proyecto: fruncido `2`, hojas `2` (modo), bajo/cresta
`0,25`, descuento altura `0,02`, añadido de cierre `0,06`, descuento riel
`0,01`, merma `5 %`.

---

## 1. Cálculo por fila (habitación)

Núcleo en `app/static/logic.js` (`calcRowFor`, envuelto como `calcRow`).
Una fila = un hueco de la relación.

Variables por fila/proyecto:

- `ancho` = ancho del hueco (m)
- `alto` = altura del hueco (m)
- `fruncido` = factor de fruncido (típico 1,00–2,50)
- `hojas` = número de paños (1–10)
- `cierre` = añadido de cierre por hoja (0,06 u 0,15 m; por defecto 0,06)
- `descuento` = descuento de altura (m)

### Fórmulas

El **añadido de cierre es una tira plana que NO se frunce** (solo el cuerpo
del paño lleva fruncido). La hoja de confección va **sin fruncido**: muestra el
ancho terminado de cada paño; el fruncido lo aplica el taller al coser.

| Concepto | Fórmula |
|---|---|
| Tela por hoja (m/hoja, compra) | `ancho ÷ hojas × fruncido + cierre` |
| **Metros de tela** (compra) | `ancho × fruncido + cierre × hojas` |
| Tela base (sin cierre) | `ancho × fruncido` |
| Cierre total | `cierre × hojas` (≡ metros − base, sin fruncir) |
| Ancho de corte (cuadrante) | `redondeo05(ancho) ÷ hojas × fruncido + cierre` |
| Alto de corte | `redondeo03(alto − descuento)` |
| Panel (ancho terminado del paño) | `ancho ÷ hojas + cierre` |
| **Hoja de confección** · Ancho 1/Ancho 2 | `redondeo05(ancho) ÷ hojas + cierre` (sin fruncido) |
| **Hoja de confección** · m/hoja | `ancho ÷ hojas + cierre` |
| **Hoja de confección** · Suma m | `ancho + cierre × hojas` (sin fruncido) |

### Ejemplo numérico

Caso real del cuadrante: **hueco 4,75 × 2,81 m, fruncido 1,50, 2 hojas,
cierre 0,06, descuento 0,02**:

- m/hoja (compra) = (4,75 ÷ 2) × 1,50 + 0,06 = 3,5625 + 0,06 = **3,62 m**
- Metros = 4,75 × 1,50 + 0,06 × 2 = 7,125 + 0,12 = **7,25 m** (7,245 exactos)
- Base = 4,75 × 1,50 = **7,13 m** · Cierre = 0,06 × 2 = **0,12 m** (sin fruncir)
- Ancho de corte (cuadrante) = (4,75 ÷ 2) × 1,50 + 0,06 = **3,62 m**
- Hoja de confección: Ancho 1/2 = 4,75 ÷ 2 + 0,06 = **2,44 m**;
  m/hoja = **2,44 m**; Suma m = 4,75 + 0,12 = **4,87 m** (sin fruncido)
- Alto de corte = redondeo03(2,81 − 0,02) = redondeo03(2,79) = **2,79 m**
- Panel = 4,75 ÷ 2 + 0,06 = **2,44 m**

Con **cierre 0,15**: m/hoja (compra) = **3,71 m**, metros = 7,125 + 0,30 =
**7,43 m** (7,425 exactos), cierre = **0,30 m**, ancho de corte (cuadrante)
**3,71 m**; hoja de confección: Ancho 1/2 = **2,53 m**, Suma m = **5,05 m**.

### Costes por fila (si hay precios)

| Concepto | Fórmula |
|---|---|
| Coste tela | `metros × precio tela/m` |
| Coste confección | `metros × precio confección/m` |
| Instalación | precio fijo por hueco |
| Base | `tela + confección + instalación` |
| Beneficio | `base × margen % ÷ 100` |
| **Total** | `base + beneficio` |

Ejemplo con los metros del caso anterior (7,245 exactos), tela 19,95 €/m,
confección 7,25 €/m, instalación 10 € y margen 25 %:

- Tela = 7,245 × 19,95 = **144,54 €** · Confección = 7,245 × 7,25 = **52,53 €**
- Base = 144,54 + 52,53 + 10 = **207,07 €**
- Beneficio = 207,07 × 25 % = **51,77 €** · Total = **258,84 €**

### Avisos automáticos (no bloquean, marcan la fila)

El **ancho del rollo de tela limita el alto de hueco** (la cortina se corta a
lo largo del rollo), así que el aviso se basa en el **alto de corte**:

- Alto de corte a **menos de 10 cm** del ancho de tela o que lo **supera**
  (p. ej. alto 2,73 m con rollo de 2,80 m avisa por el margen de 10 cm).
- Alto de corte muy corto (< 0,4 m) o mayor que un rollo habitual (> 4 m).
- Metros totales de la fila > 50 m; bajo/cresta > 1 m.

---

## 2. Totales del proyecto

`totals()` (`index.html`) suma por fila: **metros** (con fruncido), **tela
base**, costes (tela, confección, instalación), beneficio y total.

Se muestra en: KPI «Metros de tela», total de la relación («TOTAL METROS DE
TELA»), desglose del resumen, vista Revisar (pedido y merma) y exportación
Excel (hoja RELACIÓN).

La **hoja de confección** (impresa y hoja Excel CONFECCIÓN) suma sus propios
valores **sin fruncido** (`ancho + cierre × hojas` por fila), porque es el
documento del taller de costura.

---

## 3. Rieles

`railRows()` (`index.html`), a partir del ancho de cada hueco:

| Concepto | Fórmula |
|---|---|
| Medida final (riel visillo) | `ancho hueco − descuento riel` |
| Riel oscurante (riel doble) | `final ÷ 2 + cierre` (2 unidades) |
| Soportes | `⌈ancho ÷ 0,5⌉` (uno cada 50 cm, redondeo hacia arriba) |

Ejemplo: hueco **4,75 m**, descuento riel 0,01, cierre 0,06:

- Visillo = 4,75 − 0,01 = **4,74 m**
- Oscurante = 4,74 ÷ 2 + 0,06 = **2,43 m** (× 2 unidades)
- Soportes = ⌈4,75 ÷ 0,5⌉ = ⌈9,5⌉ = **10**

Se muestra en: vista **Rieles** (simple y dobles), impresión de rieles,
botón **«Exportar rieles a Excel»** (libro con hojas RIELES y RIELES DOBLES,
esta última con el oscurante y su unidad) y hoja RIELES del libro completo.

---

## 4. Pedido y merma (vista Revisar)

A partir de `metros` totales, merma configurada y metros pedidos:

| Concepto | Fórmula |
|---|---|
| Merma | `metros × % merma ÷ 100` |
| Metros a pedir | `metros + merma` |
| Diferencia | `metros pedidos − metros necesarios` |

Ejemplo: 7,31 m necesarios (7,305 exactos), merma 5 %, pedidos 8 m:

- Merma = 7,305 × 0,05 = **0,37 m** · A pedir = 7,305 + 0,365 = **7,67 m**
- Diferencia = 8 − 7,305 = **0,70 m**

El avisador comprueba además que el pedido cubra necesarios + merma
(`pedidos ≥ metros a pedir`) y que todos los fruncidos estén entre 1,00 y 2,50.

---

## 5. Resumen de cortes (Tabla de cortes)

- Agrupación por **ancho × alto de corte** (clave exacta); por grupo se suman
  huecos, paños (= suma de hojas) y metros.
- La tarjeta «Metros de tela» muestra el total con el desglose
  **«Base X m + Cierre Y m»** (cierre = total − base = `cierre × hojas`, sin
  fruncir).
- KPI de la relación: paños totales (suma de hojas) y metros de tela.

---

## 6. Etiquetas (una por paño)

- **Medida** de la etiqueta = `ancho de corte × alto de corte` (ancho del
  cuadrante, con fruncido; p. ej. «3,62 × 2,79 m»).
- **Lado**: `ÚNICA` (1 hoja), `IZQ` / `DER` (2 hojas), `HOJA n` (más de 2).
- **Código de trazabilidad**:
  `CC-<6 primeros caracteres del id del trabajo>-<habitación normalizada>-H<hoja>`
  (p. ej. `CC-1A2B3C-1101-H2`), codificado en **Code 128B** (subconjunto B,
  dígito de control propio) y renderizado como SVG.
- **ZPL Zebra**: mismo contenido a tamaño de etiqueta (40×60, 40×50, 40×80,
  50×60, 60×60 mm) a 203 dpi (`^PW`/`^LL` en puntos).

---

## 7. Importación y conversión de unidades

- `parseDimension`: convierte el valor a metros según el encabezado de la
  columna (`cm` / `mm`) o, si no hay pista, por magnitud: valores > 20 → cm
  estimados (÷100), > 1000 → mm estimados (÷1000). Valores ≤ 20 se asumen en
  metros.
- `detectExcelColumns`: localiza columnas por encabezados en español/inglés
  (habitación, ancho, altura, fruncido, bajo y cresta, nº de hojas, notas,
  estado).
- `statusFromValue`: mapea texto («Instalada», «Confeccionada», «Cortada»,
  «Medida revisada») al estado de producción.

---

## 8. Puesto de corte y órdenes (central.js)

`calculateRow` en `central.js` replica el criterio del núcleo (mismo
m/hoja, ancho de corte y metros con cierre) para las órdenes, el agrupado de
cortes y las hojas impresas desde el puesto de corte. Si cambia una fórmula en
`logic.js`, debe cambiarse también aquí.

---

## Dónde se ve cada valor

| Valor | Vistas |
|---|---|
| m/hoja (compra, con fruncido) | Relación (Medida por hoja), Cortes, Excel RELACIÓN |
| Metros de tela (compra) | Relación, Resumen, Revisar, KPI, Excel RELACIÓN |
| m/hoja y Suma m (sin fruncido) | Hoja de confección, Excel CONFECCIÓN |
| Desglose base + cierre | Resumen (tarjeta Metros de tela) |
| Ancho/alto de corte | Cortes / Etiquetas (cuadrante, con fruncido); Confección (Ancho 1/Ancho 2, sin fruncido) |
| Panel | Excel (hoja CONFECCIÓN) |
| Costes y total € | Costes (KPIs), Excel |
| Rieles y soportes | Rieles (simple y dobles), impresión, «Exportar rieles a Excel», Excel |
| Pedido y merma | Revisar |
| Etiquetas y trazabilidad | Etiquetas, ZPL / impresión Zebra |
