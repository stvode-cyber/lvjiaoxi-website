# downloads/ —— 安装包投放目录

本目录用于存放**真实产品安装包 / 安装程序**。后台上架产品时填写的 `download_url`
可直接写成本目录下的相对路径，例如：

```
/downloads/lvjiaoxi-note-win-1.2.0.exe
/downloads/lvjiaoxi-game-android-2.3.1.apk
```

## 投放方式（任选其一）

1. **手动放入**：把安装包直接复制到本目录，文件名保持稳定（升级时建议带版本号），
   然后在后台 `admin.html` 把对应产品的 `download_url` 改为上面的相对路径。
2. **后台填写外链**：若安装包托管在 CDN / 对象存储 / 应用商店，
   `download_url` 直接填完整 https 链接即可（如 `https://play.google.com/store/...`）。

## 注意事项

- 本目录已通过 `/downloads` 路由对外提供静态下载（等同于 `express.static`）。
- 下载按钮逻辑：先 `window.open(download_url)` 打开下载，再 `POST /api/downloads` 上报统计。
- 请为安装包保留可访问的 MIME 类型；Windows `.exe` / Android `.apk` 等默认由浏览器处理下载。
- 上线前请将本说明文件（`downloads/README.md`）从对外可下载范围中排除，避免暴露内部结构
  （当前 `/downloads` 为整目录静态托管，介意者可改为仅放行特定扩展名）。
