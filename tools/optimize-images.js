/**
 * 图片优化工具：把 assets/img 下的大图压缩为适合 Web 投放的体积。
 *
 * 用法：
 *   node tools/optimize-images.js
 *
 * 依赖 sharp（原生模块，未写入 package.json，按需安装）：
 *   npm install --no-save sharp
 *
 * 规则：
 *   - hero-bg.*   → 宽度上限 1920，转渐进式 JPEG（q78, mozjpeg），装饰性底图用 JPEG 性价比最高
 *   - icon-512.*  → 缩到 512×512，PNG 高压缩（保留透明通道，PWA 安装用）
 *   - og.*        → 宽度上限 1200，JPEG q82（仅爬虫抓取，不参与页面加载）
 *
 * 幂等：重复执行只会再压一次，已压缩文件会被同名覆盖（请先备份原始素材）。
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'img');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('[缺少依赖] 请先执行： npm install --no-save sharp');
  process.exit(1);
}

const kb = (n) => (n / 1024).toFixed(1) + 'KB';
const pct = (a, b) => '-' + Math.round((1 - b / a) * 100) + '%';

async function job(name, run) {
  const before = fs.statSync(path.join(DIR, name)).size;
  const out = await run();
  const after = fs.statSync(path.join(DIR, out.file)).size;
  console.log(`${name.padEnd(16)} ${kb(before).padStart(9)}  →  ${out.file.padEnd(16)} ${kb(after).padStart(9)}  ${pct(before, after)}`);
}

(async () => {
  if (!fs.existsSync(DIR)) {
    console.error('[目录不存在]', DIR);
    process.exit(1);
  }

  if (fs.existsSync(path.join(DIR, 'hero-bg.png'))) {
    await job('hero-bg.png', async () => {
      const f = 'hero-bg.jpg';
      await sharp(path.join(DIR, 'hero-bg.png'))
        .resize({ width: 1920, withoutEnlargement: true })
        .jpeg({ quality: 78, progressive: true, mozjpeg: true })
        .toFile(path.join(DIR, f));
      return { file: f };
    });
  }

  if (fs.existsSync(path.join(DIR, 'icon-512.png'))) {
    await job('icon-512.png', async () => {
      const f = 'icon-512.png';
      const tmp = 'icon-512.tmp.png';
      await sharp(path.join(DIR, f))
        .resize(512, 512, { fit: 'cover' })
        .png({ compressionLevel: 9 })
        .toFile(path.join(DIR, tmp));
      fs.renameSync(path.join(DIR, tmp), path.join(DIR, f));
      return { file: f };
    });
  }

  if (fs.existsSync(path.join(DIR, 'og.png'))) {
    await job('og.png', async () => {
      const f = 'og.jpg';
      await sharp(path.join(DIR, 'og.png'))
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toFile(path.join(DIR, f));
      return { file: f };
    });
  }

  console.log('\n--- 最终素材 ---');
  for (const f of fs.readdirSync(DIR).filter((n) => /\.(png|jpe?g)$/i.test(n))) {
    const m = await sharp(path.join(DIR, f)).metadata();
    const s = fs.statSync(path.join(DIR, f)).size;
    console.log(`${f.padEnd(18)} ${String(m.width + 'x' + m.height).padEnd(12)} ${m.format.padEnd(5)} ${kb(s)}`);
  }
})().catch((e) => {
  console.error('[失败]', e.message);
  process.exit(1);
});
