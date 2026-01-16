/**
 * Flipkart Vendor Hub Login Task
 * Handles email + password authentication (no OTP required)
 * After login, selects FKI account
 */

import { BaseTask } from '../../core/BaseTask.js';
import { config } from '../../config/index.js';

export class FlipkartLoginTask extends BaseTask {
  constructor(taskConfig) {
    super(taskConfig);
    this.flipkartEmail = taskConfig.flipkartEmail;
    this.flipkartPassword = taskConfig.flipkartPassword;
    this.companyName = taskConfig.companyName || '';
  }

  /**
   * Main login flow
   */
  async run() {
    console.log('\n📋 Starting Flipkart Vendor Hub Login...\n');

    // Step 1: Navigate to login page
    await this.navigateToLoginPage();

    // Step 2: Enter email
    await this.enterEmail();

    // Step 3: Enter password
    await this.enterPassword();

    // Step 4: Wait for user to solve CAPTCHA and submit
    await this.waitForUserLogin();

    // Step 5: Select FKI + Company
    await this.selectFKI();

    console.log('\n✅ Flipkart login completed successfully!\n');
  }

  /**
   * Wait for user to solve CAPTCHA and click submit manually
   */
  async waitForUserLogin() {
    console.log('\n' + '='.repeat(50));
    console.log('👆 MANUAL ACTION REQUIRED:');
    console.log('   1. Solve the reCAPTCHA');
    console.log('   2. Click the Sign In button');
    console.log('='.repeat(50));
    console.log('⏳ Waiting for you to complete login...\n');

    // Wait for the URL to change from login page (indicating successful login)
    // or wait for the FKI/company selection screen to appear
    try {
      await this.page.waitForFunction(
        () => !window.location.href.includes('/welcome/login'),
        { timeout: 300000 } // Wait up to 5 minutes for user to complete login
      );
      console.log('✅ Login detected! Taking over...');
    } catch (err) {
      console.log('⚠️  Login timeout - checking if already logged in...');
    }

    // Give the page time to fully load after login
    await this.page.waitForTimeout(3000);
  }

  /**
   * Navigate to Flipkart Vendor Hub login page
   */
  async navigateToLoginPage() {
    console.log('🌐 Navigating to Flipkart Vendor Hub login page...');
    await this.navigateTo('https://vendorhub.flipkart.com/#/welcome/login');
    await this.page.waitForTimeout(2000);
    console.log('✅ Login page loaded');
  }

  /**
   * Enter email address
   */
  async enterEmail() {
    console.log('📧 Looking for email field...');

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[id*="email" i]',
      'input[placeholder*="Email" i]',
      'input[type="text"]'
    ];

    const emailSelector = await this.waitForElement(emailSelectors, 15000);
    console.log('⌨️  Entering email address...');
    await this.typeIntoField(emailSelector, this.flipkartEmail);
    console.log('✅ Email entered');
  }

  /**
   * Enter password
   */
  async enterPassword() {
    console.log('🔐 Looking for password field...');

    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="password" i]',
      'input[id*="password" i]'
    ];

    const passwordSelector = await this.waitForElement(passwordSelectors, 10000);
    console.log('⌨️  Entering password...');

    // Use fill() instead of type() for passwords with special characters
    await this.page.click(passwordSelector);
    await this.page.fill(passwordSelector, this.flipkartPassword);

    console.log('✅ Password entered');
  }

  /**
   * Click the login button
   */
  async clickLoginButton() {
    console.log('🔍 Looking for login button...');

    // Try multiple approaches to find and click the login button
    const buttonFound = await this.tryClickLoginButton();

    if (!buttonFound) {
      // Fallback: Press Enter
      console.log('⚠️  Login button not found, pressing Enter...');
      await this.page.keyboard.press('Enter');
    }

    console.log('✅ Login submitted');
    await this.page.waitForTimeout(3000);
  }

  /**
   * Try various methods to click the login button
   */
  async tryClickLoginButton() {
    // Approach 1: Try text-based locators
    const buttonTexts = ['Login', 'Log In', 'Sign In', 'Submit'];
    for (const text of buttonTexts) {
      try {
        const button = this.page.locator(`button:has-text("${text}")`).first();
        const isVisible = await button.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          await button.click();
          console.log(`✅ Clicked "${text}" button`);
          return true;
        }
      } catch (err) {
        continue;
      }
    }

    // Approach 2: Try submit button
    try {
      const submitButton = await this.page.$('button[type="submit"]');
      if (submitButton) {
        await submitButton.click();
        console.log('✅ Clicked submit button');
        return true;
      }
    } catch (err) {
      // Continue to next approach
    }

    // Approach 3: Try any button with login-related class
    try {
      const buttons = await this.page.$$('button');
      for (const button of buttons) {
        const text = await button.textContent();
        if (text && (text.toLowerCase().includes('login') || text.toLowerCase().includes('sign in'))) {
          await button.click();
          console.log('✅ Clicked login button');
          return true;
        }
      }
    } catch (err) {
      // Continue
    }

    return false;
  }

  /**
   * Select account/company after login
   */
  async selectFKI() {
    console.log('🏢 Waiting for account selection screen...');
    await this.page.waitForTimeout(3000);

    if (!this.companyName) {
      console.log('⚠️  No company name configured, skipping company selection...');
      return;
    }

    // Step 1: Try to select company directly (for accounts without FKI step)
    console.log(`🔍 Looking for ${this.companyName}...`);
    let companyClicked = false;

    try {
      // Try text locator with exact name
      const companyElement = this.page.locator(`text="${this.companyName}"`).first();
      const isVisible = await companyElement.isVisible({ timeout: 5000 }).catch(() => false);

      if (isVisible) {
        await companyElement.click();
        console.log(`✅ Selected: ${this.companyName}`);
        companyClicked = true;
      }
    } catch (err) {
      // Try alternative
    }

    // Fallback: search with partial match (first two words of company name)
    if (!companyClicked) {
      const searchTerm = this.companyName.split(' ').slice(0, 2).join(' ').toUpperCase();
      try {
        const elements = await this.page.$$('div, span, li, button, a, td');
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.toUpperCase().includes(searchTerm)) {
            await element.click();
            console.log('✅ Selected company (via element search)');
            companyClicked = true;
            break;
          }
        }
      } catch (err) {
        console.log('⚠️  Could not find company');
      }
    }

    if (!companyClicked) {
      // Try FKI flow as fallback
      console.log('⚠️  Company not found directly, trying FKI flow...');
      await this.tryFKIFlow();
      return;
    }

    // Wait a moment after selecting company
    await this.page.waitForTimeout(1000);

    // Click Next/Continue button if present
    await this.clickNextButton();

    // Wait for dashboard to load
    await this.page.waitForTimeout(3000);
  }

  /**
   * Try FKI selection flow (for certain account types)
   */
  async tryFKIFlow() {
    console.log('🔍 Looking for FKI...');
    let fkiClicked = false;

    try {
      const fkiElement = this.page.locator('text="FKI"').first();
      const isVisible = await fkiElement.isVisible({ timeout: 3000 }).catch(() => false);

      if (isVisible) {
        await fkiElement.click();
        console.log('✅ Clicked FKI');
        fkiClicked = true;
      }
    } catch (err) {
      // Continue
    }

    if (!fkiClicked) {
      console.log('⚠️  FKI not found - continuing...');
      return;
    }

    await this.page.waitForTimeout(1000);
    await this.clickNextButton();
    await this.page.waitForTimeout(2000);

    // Select company after FKI
    console.log('🏢 Looking for company after FKI...');
    const searchTerm = this.companyName.split(' ').slice(0, 2).join(' ').toUpperCase();
    try {
      const elements = await this.page.$$('div, span, li, button, a, td');
      for (const element of elements) {
        const text = await element.textContent();
        if (text && text.toUpperCase().includes(searchTerm)) {
          await element.click();
          console.log('✅ Selected company');
          break;
        }
      }
    } catch (err) {
      console.log('⚠️  Could not find company');
    }

    await this.page.waitForTimeout(1000);
    await this.clickNextButton();
    await this.page.waitForTimeout(3000);
  }

  /**
   * Click Next/Continue button if present
   */
  async clickNextButton() {
    console.log('🔍 Looking for Next button...');
    try {
      const nextButton = this.page.locator('button:has-text("Next"), a:has-text("Next"), button:has-text("Continue"), text="Next"').first();
      const isVisible = await nextButton.isVisible({ timeout: 3000 }).catch(() => false);

      if (isVisible) {
        await nextButton.click();
        console.log('✅ Clicked Next');
      } else {
        // Try fallback
        const buttons = await this.page.$$('button, a');
        for (const btn of buttons) {
          const text = await btn.textContent();
          if (text && (text.trim().toLowerCase() === 'next' || text.trim().toLowerCase() === 'continue')) {
            await btn.click();
            console.log('✅ Clicked Next (via search)');
            break;
          }
        }
      }
    } catch (err) {
      console.log('⚠️  Next button not found');
    }
  }
}
