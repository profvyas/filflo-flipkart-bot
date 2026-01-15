/**
 * BaseTask - Abstract base class for all automation tasks
 * Provides common functionality and structure for all bot tasks
 */

import { chromium } from 'playwright';
import { config } from '../config/index.js';

export class BaseTask {
  constructor(config = {}) {
    this.config = config;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.taskName = this.constructor.name;
  }

  /**
   * Initialize browser and create new page
   */
  async initialize() {
    console.log(`🚀 Initializing ${this.taskName}...`);
    
    // Use headless mode from config (defaults to true in production)
    const headlessMode = this.config.headless !== undefined 
      ? this.config.headless 
      : config.browser.headless;
    
    this.browser = await chromium.launch({
      headless: headlessMode,
      args: headlessMode 
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] // Required for containerized environments
        : ['--start-maximized']
    });

    this.context = await this.browser.newContext({
      viewport: null,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    this.page = await this.context.newPage();
    
    console.log('✅ Browser initialized');
  }

  /**
   * Set existing browser context (for sharing between tasks)
   */
  setBrowserContext(browser, context, page) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    console.log(`✅ Using shared browser context for ${this.taskName}`);
  }

  /**
   * Navigate to a URL
   */
  async navigateTo(url) {
    console.log(`🌐 Navigating to ${url}...`);
    try {
      // Use 'load' instead of 'networkidle' to avoid timeouts on pages with continuous network activity
      await this.page.goto(url, { 
        waitUntil: 'load',
        timeout: 60000 // Increase timeout to 60 seconds
      });
      console.log('✅ Page loaded');
    } catch (error) {
      // If load times out, try with domcontentloaded as fallback
      if (error.message.includes('Timeout')) {
        console.log('⚠️  Load timeout, trying with domcontentloaded...');
        await this.page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        console.log('✅ Page loaded (domcontentloaded)');
      } else {
        throw error;
      }
    }
  }

  /**
   * Wait for selector with multiple attempts
   */
  async waitForElement(selectors, timeout = 10000) {
    if (!Array.isArray(selectors)) {
      selectors = [selectors];
    }

    for (const selector of selectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: timeout / selectors.length });
        console.log(`✅ Found element: ${selector}`);
        return selector;
      } catch (err) {
        continue;
      }
    }

    throw new Error(`Could not find any of the selectors: ${selectors.join(', ')}`);
  }

  /**
   * Type text into an input field
   */
  async typeIntoField(selector, text, options = {}) {
    await this.page.click(selector);
    await this.page.fill(selector, ''); // Clear first
    await this.page.type(selector, text, { delay: options.delay || 50 });
  }

  /**
   * Click an element
   */
  async clickElement(selector) {
    await this.page.click(selector);
  }

  /**
   * Take screenshot for debugging
   */
  async takeScreenshot(filename = 'screenshot.png') {
    await this.page.screenshot({ path: filename, fullPage: true });
    console.log(`📸 Screenshot saved: ${filename}`);
  }

  /**
   * Cleanup - close browser
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 Browser closed');
    }
  }

  /**
   * Main execution method - must be implemented by subclasses
   */
  async run() {
    throw new Error('run() method must be implemented by subclass');
  }

  /**
   * Execute the task with error handling
   */
  async execute() {
    try {
      await this.initialize();
      await this.run();
      console.log('\n✅ Task completed!');
      console.log('🔒 Closing browser...');
      await this.cleanup();
    } catch (error) {
      console.error(`❌ Error in ${this.taskName}:`, error.message);
      if (this.page) {
        await this.takeScreenshot(`error-${Date.now()}.png`);
      }
      await this.cleanup();
      throw error;
    }
  }
}

