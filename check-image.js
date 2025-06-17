import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

const LOGIN_URL = process.env.URL_LOGIN;
const TARGET_URL = process.env.URL_TARGET;
const USERNAME = process.env.LOGIN_ID;
const PASSWORD = process.env.LOGIN_PASS;
const TARGET_IMG = process.env.TARGET_IMG;

(async () => {
  let browser;

  try {
    console.log('Starting browser launch...');

    // Chrome実行パスを複数候補から取得
    let chromePath;
    const pathCandidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser'
    ];
    
    for (const path of pathCandidates) {
      try {
        execSync(`test -f ${path}`);
        chromePath = path;
        console.log(`Chrome found at: ${chromePath}`);
        break;
      } catch (e) {
        console.log(`Chrome not found at: ${path}`);
      }
    }
    
    if (!chromePath) {
      throw new Error('Chrome executable not found in any expected location');
    }

    // Chrome起動オプション（GitHub Actions最適化）
    const launchOptions = {
      headless: 'new',
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      timeout: 60000,
      protocolTimeout: 60000,
    };

    console.log('Launch options:', JSON.stringify(launchOptions, null, 2));
    
    browser = await puppeteer.launch(launchOptions);
    console.log('Browser launched successfully');
    
    const page = await browser.newPage();
    
    // ページタイムアウト設定
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    console.log('Starting login process...');
    
    // ログイン
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Login page loaded');
    
    await page.setCacheEnabled(false); // キャッシュの無効化
    
    // ログイン情報入力
    await page.type('input[name="username"]', USERNAME);
    await page.type('input[name="password"]', PASSWORD);
    console.log('Credentials entered');

    await Promise.all([
      page.click('#user_account_mode'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    if (page.url().includes('/accounts/login')) {
      throw new Error('ログインに失敗しました。');
    }

    console.log('Login successful, navigating to target page...');

    // 対象ページへ遷移
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(1500); // 画像読み込み待ち
    
console.log('Target page loaded, checking image...');
// 特定画像の検査
const result = await page.evaluate((targetImg) => {
    console.log(`img[src="${targetImg}"]`);
  const img = document.querySelector(`img[src="${targetImg}"]`);
  if (!img) return { status: 'not found' };

  const style = window.getComputedStyle(img);
  return {
    status: (
      !img.complete ||
      img.naturalWidth === 0 ||
      img.naturalHeight === 0 ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0
    ) ? 'broken' : 'ok',
    width: img.naturalWidth,
    height: img.naturalHeight,
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    src: img.src
  };
}, TARGET_IMG); 

    if (result.status === 'ok') {
      console.log(`✅ 画像正常`);
    } else if (result.status === 'broken') {
      console.error(`❌ 表示エラー: ${result.src}`);
      console.error(`詳細: width=${result.width}, height=${result.height}, display=${result.display}, visibility=${result.visibility}, opacity=${result.opacity}`);
      process.exit(1);
    } else {
      console.error(`⚠️ 画像がDOMに存在しません`);
      process.exit(1);
    }

  } catch (err) {
    console.error('Error occurred during image check:');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Stack trace:', err.stack);
    
    // タイムアウトエラーの場合の詳細情報
    if (err.name === 'TimeoutError') {
      console.error('This is a timeout error. Possible causes:');
      console.error('1. Chrome failed to start within the timeout period');
      console.error('2. Missing Chrome dependencies');
      console.error('3. Insufficient system resources');
      console.error('4. Network connectivity issues');
    }
    
    // ログイン関連エラーの場合
    if (err.message.includes('ログインに失敗')) {
      console.error('Login failed. Please check:');
      console.error('1. LOGIN_ID and LOGIN_PASS environment variables are set correctly');
      console.error('2. Website login process has not changed');
      console.error('3. Account is not locked or suspended');
    }
    
    console.error(`⚠️ エラー: ${err.message}`);
    process.exit(1);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
})();