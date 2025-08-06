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
    
    // 特定画像の検査（改善版）
    const result = await page.evaluate((targetImg) => {
      // TARGET_IMGからクエリパラメータを除去したベースパスを作成
      const basePath = targetImg.split('?')[0];
      
      // 1. ベースパス（クエリパラメータなし）での部分一致検索
      let img = null;
      let matchType = '';
      const allImages = document.querySelectorAll('img');
      
      for (const image of allImages) {
        if (image.src && image.src.includes(basePath)) {
          img = image;
          matchType = 'base_path_match';
          break;
        }
      }
      
      // 2. ファイル名のみでの検索（フォールバック）
      if (!img) {
        const filename = basePath.split('/').pop();
        for (const image of allImages) {
          if (image.src && image.src.includes(filename)) {
            img = image;
            matchType = 'filename_match';
            break;
          }
        }
      }
      
      if (!img) {
        // デバッグ用：ページ内の全画像を出力
        const allImgSrcs = Array.from(allImages).map(i => ({
          src: i.src,
          alt: i.alt,
          className: i.className
        }));
        return { 
          status: 'not found',
          allImages: allImgSrcs,
          searchedBasePath: basePath,
          searchedFilename: basePath.split('/').pop()
        };
      }

      const style = window.getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      
      // 画像の状態を詳細にチェック
      const isVisible = (
        img.complete &&
        img.naturalWidth > 0 &&
        img.naturalHeight > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        parseFloat(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
      
      return {
        status: isVisible ? 'ok' : 'broken',
        matchType: matchType,
        actualSrc: img.src,
        searchedFor: targetImg,
        basePath: basePath,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        boundingBox: {
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y
        },
        alt: img.alt,
        className: img.className
      };
    }, TARGET_IMG);

    console.log('Image check result:', JSON.stringify(result, null, 2));

    if (result.status === 'ok') {
      console.log(`✅ 画像正常 (${result.matchType})`);
      console.log(`検索パス: ${result.basePath}`);
      console.log(`実際のSRC: ${result.actualSrc}`);
      console.log(`画像サイズ: ${result.naturalWidth}x${result.naturalHeight}`);
      console.log(`表示サイズ: ${result.boundingBox.width}x${result.boundingBox.height}`);
    } else if (result.status === 'broken') {
      console.error(`❌ 画像表示エラー`);
      console.error(`マッチタイプ: ${result.matchType}`);
      console.error(`検索パス: ${result.basePath}`);
      console.error(`実際のSRC: ${result.actualSrc}`);
      console.error(`詳細情報:`);
      console.error(`  complete: ${result.complete}`);
      console.error(`  naturalWidth: ${result.naturalWidth}`);
      console.error(`  naturalHeight: ${result.naturalHeight}`);
      console.error(`  display: ${result.display}`);
      console.error(`  visibility: ${result.visibility}`);
      console.error(`  opacity: ${result.opacity}`);
      console.error(`  boundingBox: ${JSON.stringify(result.boundingBox)}`);
      process.exit(1);
    } else {
      console.error(`⚠️ 画像がDOMに存在しません`);
      console.error(`検索ベースパス: ${result.searchedBasePath}`);
      console.error(`検索ファイル名: ${result.searchedFilename}`);
      console.error(`ページ内の画像一覧 (最初の10件):`);
      result.allImages.slice(0, 10).forEach((imgInfo, index) => {
        console.error(`  ${index + 1}: ${imgInfo.src}`);
        if (imgInfo.alt) console.error(`     alt: ${imgInfo.alt}`);
        if (imgInfo.className) console.error(`     class: ${imgInfo.className}`);
      });
      if (result.allImages.length > 10) {
        console.error(`  ... and ${result.allImages.length - 10} more images`);
      }
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