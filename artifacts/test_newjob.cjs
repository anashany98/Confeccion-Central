// Test E2E: nuevo trabajo con las 3 opciones (blank, duplicate, template)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('401')) {
      errors.push('console.error: ' + msg.text());
    }
  });

  // Login
  await page.goto('http://localhost:8181/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#centralLoginUser', { timeout: 10000 });
  await page.fill('#centralLoginUser', 'admin');
  await page.fill('#centralLoginPassword', 'aR3PYtglwFQdaBqJbjA9PBMGtZB5rkXEww7GPfw6A');
  await page.click('#centralLoginForm button[type="submit"]');
  await page.waitForTimeout(1500);

  // Crear un trabajo de prueba primero para tener algo que duplicar
  console.log('=== Setup: crear trabajo base ===');
  await page.click('#sidebarNewJobBtn');
  await page.waitForSelector('#newJobModal.open');
  await page.fill('#newJobName', 'Trabajo base para duplicar');
  await page.click('#newJobCreateBtn');
  await page.waitForTimeout(500);
  console.log('   Trabajo base creado');

  // TEST 1: opciÃ³n blank
  console.log('\n=== TEST 1: Empezar de cero ===');
  await page.click('#sidebarNewJobBtn');
  await page.waitForSelector('#newJobModal.open');
  await page.fill('#newJobName', 'Trabajo blank');
  await page.click('#newJobCreateBtn');
  await page.waitForTimeout(500);
  const hotelBlank = await page.$eval('#p-hotel', (el) => el.value);
  console.log('   Hotel tras blank:', hotelBlank);
  if (hotelBlank !== 'Trabajo blank') throw new Error('Blank no funcionÃ³');

  // TEST 2: opciÃ³n duplicate
  console.log('\n=== TEST 2: Duplicar trabajo ===');
  await page.click('#sidebarNewJobBtn');
  await page.waitForSelector('#newJobModal.open');
  await page.click('[data-newjob-source="duplicate"]');
  await page.waitForTimeout(200);
  const dupVisible = await page.$eval('#newJobDuplicatePicker', (el) => !el.hidden);
  const dupOptions = await page.$$eval('#newJobDuplicateSelect option', (els) => els.length);
  console.log('   Picker de duplicar visible:', dupVisible, 'Â· opciones:', dupOptions);
  if (!dupVisible) throw new Error('Picker de duplicar no se mostrÃ³');
  if (dupOptions < 1) throw new Error('No hay opciones en el selector de duplicar');
  // Seleccionar el segundo trabajo (el mÃ¡s reciente de los nuestros)
  const dupOptionsList = await page.$$eval('#newJobDuplicateSelect option', (els) =>
    els.map((o) => ({ value: o.value, text: o.textContent.trim() })),
  );
  console.log('   Opciones:', dupOptionsList);
  const targetOpt = dupOptionsList.find((o) => o.text.includes('Trabajo base'));
  if (targetOpt) {
    await page.selectOption('#newJobDuplicateSelect', targetOpt.value);
  }
  await page.fill('#newJobName', 'Trabajo duplicado');
  await page.click('#newJobCreateBtn');
  await page.waitForTimeout(500);
  const hotelDup = await page.$eval('#p-hotel', (el) => el.value);
  console.log('   Hotel tras duplicate:', hotelDup);
  if (hotelDup !== 'Trabajo duplicado') throw new Error('Duplicate no funcionÃ³');

  // TEST 3: opciÃ³n template
  console.log('\n=== TEST 3: Aplicar plantilla ===');
  await page.click('#sidebarNewJobBtn');
  await page.waitForSelector('#newJobModal.open');
  await page.click('[data-newjob-source="template"]');
  await page.waitForTimeout(200);
  const tplVisible = await page.$eval('#newJobTemplatePicker', (el) => !el.hidden);
  const tplOptions = await page.$$eval('#newJobTemplateSelect option', (els) => els.length);
  console.log('   Picker de plantilla visible:', tplVisible, 'Â· opciones:', tplOptions);
  if (!tplVisible) throw new Error('Picker de plantilla no se mostrÃ³');
  if (tplOptions < 1) throw new Error('No hay opciones en el selector de plantilla');
  // Verificar que el gather se aplica desde la plantilla builtin "std2" (gather=2)
  const tplFirstValue = await page.$eval('#newJobTemplateSelect', (el) => el.value);
  console.log('   Plantilla por defecto:', tplFirstValue);
  await page.fill('#newJobName', 'Trabajo con plantilla');
  await page.click('#newJobCreateBtn');
  await page.waitForTimeout(500);
  const gatherApplied = await page.$eval('#d-gather', (el) => el.value);
  const fabricType = await page.$eval('#p-fabricType', (el) => el.value);
  console.log('   Gather tras aplicar plantilla:', gatherApplied, 'Â· fabricType:', fabricType);
  if (!gatherApplied || gatherApplied === '0' || gatherApplied === '') {
    throw new Error('La plantilla no se aplicÃ³ (gather vacÃ­o)');
  }
  if (fabricType !== 'oscurante') {
    throw new Error('fabricType no se aplicÃ³ desde la plantilla (esperado oscurante, got: ' + fabricType + ')');
  }

  if (errors.length) {
    console.log('\nERRORES:');
    for (const e of errors) console.log('  -', e);
    throw new Error('Hubo errores en la pÃ¡gina');
  }

  console.log('\nâœ… TODO OK');
  await browser.close();
})().catch((e) => { console.error('\nâŒ FALLO:', e.message); process.exit(1); });

