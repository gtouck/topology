import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, testDir: './tests/performance', outputDir: './performance-results', fullyParallel: false, workers: 1, timeout: 90_000 });
