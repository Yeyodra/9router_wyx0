const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Enable request interception
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().includes('codebuddy')) {
      console.log('=== CAPTURED REQUEST ===');
      console.log('URL:', request.url());
      console.log('Method:', request.method());
      console.log('Headers:', JSON.stringify(request.headers(), null, 2));
      try {
        const postData = request.postData();
        console.log('Body:', postData);
      } catch(e) {}
      console.log('========================');
    }
    await route.continue();
  });
  
  // Navigate to CodeBuddy login
  console.log('Navigating to CodeBuddy...');
  await page.goto('https://www.codebuddy.ai/login');
  await page.waitForTimeout(2000);
  
  // Take screenshot
  await page.screenshot({ path: '.omo/evidence/codebuddy-login-page.png' });
  console.log('Screenshot saved. Please login manually in the browser window.');
  console.log('Email: wisyam@apiquemanagement.com');
  console.log('Password: wisyamsandi2023@');
  
  // Wait for user to login and navigate to API key page
  await page.waitForTimeout(120000); // 2 minutes for manual login
  
  await browser.close();
})();
