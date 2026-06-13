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
  
  console.log('Screenshot saved. Please login manually in the browser window.');
  console.log('Email: wisyam@apiquemanagement.com');
  console.log('Password: wisyamsandi2023@');
  console.log('\n=== IMPORTANT ===');
  console.log('After login, please navigate to:');
  console.log('1. Settings or Profile page');
  console.log('2. Look for "API Keys" or "Tokens" section');
  console.log('3. Create a new API key');
  console.log('4. The POST request for creating the key will be captured');
  console.log('==================\n');
  
  // Wait for user to login and create API key (5 minutes)
  await page.waitForTimeout(300000);
  
  await browser.close();
})();
