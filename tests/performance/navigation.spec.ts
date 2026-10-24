import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { largeTopology } from '../fixtures/large-topology';

const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
for (const [nodes, edges] of [[100, 300], [300, 1000]]) test(`S10 性能 ${nodes} 节点 ${edges} 链路`, async ({ page, context }, testInfo) => {
  const definition = largeTopology(nodes, edges);
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click(); await page.locator('[data-action="pause"]').click();
  const start = await page.evaluate(() => performance.now());
  await page.locator('#import-file').setInputFiles({ name: 'large.topology.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)) });
  await expect(page.locator('.device-card')).toHaveCount(nodes); await settle(page);
  const editorLoadMs = await page.evaluate(start => performance.now() - start, start);
  await page.evaluate(() => window.stationPrototype.focus('node-0'));
  const original = await page.evaluate(() => window.stationPrototype.snapshot());
  await page.evaluate(() => {
    const times: number[] = [];
    const measure = () => { const start = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => times.push(performance.now() - start))); };
    window.stationPrototype.graph.on('node:change:position', measure);
    (window as unknown as { stopDragMeasurement: () => number[] }).stopDragMeasurement = () => { window.stationPrototype.graph.off('node:change:position', measure); return times; };
  });
  const box = (await page.locator('[data-device-node="node-0"]').boundingBox())!;
  const dragStart = await page.evaluate(() => performance.now());
  await page.mouse.move(box.x + 80, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 110, box.y + 40, { steps: 8 }); await page.mouse.up(); await settle(page);
  const dragMs = await page.evaluate(start => performance.now() - start, dragStart);
  const dragFrameMs = await page.evaluate(() => (window as unknown as { stopDragMeasurement: () => number[] }).stopDragMeasurement());
  expect(dragFrameMs.length).toBeGreaterThan(0);
  expect((await page.evaluate(() => window.stationPrototype.snapshot())).nodes[0].x).not.toBe(original.nodes[0].x);
  await page.locator('[data-action="undo"]').click(); expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(original);
  const display = await context.newPage(); await display.goto('/viewer.html');
  const viewerLoadMs = await display.evaluate(async definition => { const start = performance.now(); window.topologyViewer.setDefinition(definition); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); return performance.now() - start; }, definition);
  const refresh = await display.evaluate(async ({ nodes, edges }) => {
    const times: number[] = [];
    for (let round = 0; round < 6; round++) {
      const data = Object.fromEntries(Array.from({ length: nodes }, (_, i) => [`DEV-${i}`, { status: 'normal', load: 20 + round + i / 10, temperature: 35 + round }]));
      const links = Object.fromEntries(Array.from({ length: edges }, (_, i) => [`edge-${i}`, { status: 'up' as const, active: true }]));
      const start = performance.now(); window.topologyViewer.updateData(data); window.topologyViewer.updateLinkData(links);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (round > 0) times.push(performance.now() - start);
    }
    return times;
  }, { nodes, edges });
  const measurement = { nodes, edges, project: testInfo.project.name, browser: context.browser()!.version(), platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, viewport: testInfo.project.use.viewport ?? { width: 1600, height: 1050 }, editorImportAndPaintMs: editorLoadMs, dragSequenceAndPaintMs: dragMs, dragPositionToPaintMs: dragFrameMs, viewerDefinitionAndPaintMs: viewerLoadMs, batchRefreshAndPaintMs: refresh, note: 'Real clock, one worker; editor import includes automation file transfer, simulator paused; drag is eight automation pointer steps; position/refresh metrics include two animation frames; viewer uses default live animation; refresh excludes one warm-up.' };
  expect([editorLoadMs, dragMs, viewerLoadMs, ...refresh].every(value => Number.isFinite(value) && value > 0)).toBe(true);
  expect(await display.evaluate(() => window.topologyViewer.getDefinition())).toEqual(definition);
  await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify(measurement, null, 2));
  await testInfo.attach('measurements', { body: JSON.stringify(measurement), contentType: 'application/json' });
});
