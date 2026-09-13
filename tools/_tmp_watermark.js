// 一次性脚本：裁剪产品图右下角"AI生成"水印（底部 220px），并压到 960 宽供网页投放
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const DIR = path.join(process.cwd(), 'assets', 'img', 'products');
const names = ['note', 'team', 'cloud', 'password', 'space', 'candy', 'racing', 'pixel'];
(async () => {
  for (const n of names) {
    const src = path.join(DIR, n + '.jpg');
    const tmp = path.join(DIR, n + '.tmp.jpg');
    await sharp(src)
      .metadata()
      .then((m) => sharp(src)
        .extract({ left: 0, top: 0, width: m.width, height: m.height - 220 })
        .resize({ width: 960, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toFile(tmp));
    fs.renameSync(tmp, src);
    const meta = await sharp(src).metadata();
    console.log(n + '.jpg → ' + meta.width + 'x' + meta.height + ' ' + (fs.statSync(src).size / 1024).toFixed(0) + 'KB');
  }
  console.log('done');
})().catch((e) => { console.error('[失败]', e.message); process.exit(1); });
