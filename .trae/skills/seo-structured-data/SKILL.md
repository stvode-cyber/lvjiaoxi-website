# SEO & 结构化数据

## 触发条件
上线前、改了页面内容、或用户说"搜索排名怎么上去"时使用。

## 当前状态检查

```bash
# 检查已有的 SEO 元素
grep -l "og:\|twitter:\|ld+json\|sitemap" *.html *.js 2>/dev/null || echo "无 SEO 元素"
```

绿角犀已有：sitemap 生成（后端）、OG 图（og.jpg）、基础 meta。

## 优化清单

### 1. 每个页面的 meta（必须）

```html
<!-- 在所有 HTML 页面 head 里 -->
<meta name="description" content="绿角犀安全浏览器官网 - 极速、安全、无广告的浏览器">
<meta name="keywords" content="安全浏览器,隐私浏览器,无广告浏览器,绿角犀">

<!-- Open Graph -->
<meta property="og:title" content="绿角犀安全浏览器">
<meta property="og:description" content="极速、安全、无广告的浏览器">
<meta property="og:image" content="./assets/img/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="https://lvjiaoxi.com/">
<meta property="og:type" content="website">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="绿角犀安全浏览器">
<meta name="twitter:description" content="极速、安全、无广告的浏览器">
<meta name="twitter:image" content="./assets/img/og.jpg">
```

### 2. 结构化数据 JSON-LD（每个页面加）

**首页**：

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "绿角犀安全浏览器",
  "url": "https://lvjiaoxi.com",
  "description": "极速、安全、无广告的浏览器",
  "applicationCategory": "BrowserApplication",
  "operatingSystem": "Windows, macOS, Linux",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "CNY"
  }
}
</script>
```

**产品页**（每个产品一条）：

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "绿角犀安全浏览器",
  "version": "1.2.0",
  "description": "安全浏览器产品描述",
  "downloadUrl": "/downloads/lvjiaoxi-setup.exe",
  "operatingSystem": "Windows, macOS, Linux",
  "applicationCategory": "BrowserApplication",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "CNY"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.5",
    "ratingCount": "100"
  }
}
</script>
```

### 3. 后端 sitemap 增强

当前后端已生成 sitemap。确认：

```bash
curl -s http://127.0.0.1:3002/sitemap.xml | head -20
# 必须包含：所有 HTML 页面 + 所有产品 + 最近更新时间
```

**增强建议**：
- 加 `changefreq`（首页 daily，产品页 weekly）
- 加 `priority`（首页 1.0，产品页 0.8，其他 0.6）
- 产品更新时自动更新 sitemap

### 4. robots.txt

```
# /public/robots.txt（Express 静态目录）
User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /api/admin/
Sitemap: https://lvjiaoxi.com/sitemap.xml
```

### 5. 性能 SEO

| 指标 | 目标 | 当前 | 优化 |
|------|------|------|------|
| LCP | < 2.5s | ? | 骨架屏 + 图片懒加载 |
| CLS | < 0.1 | ? | 图片固定宽高 |
| FID | < 100ms | ? | 减少首屏 JS |

```bash
# 本地测
curl -s -o /dev/null -w "首屏加载: %{time_total}s\n" http://127.0.0.1:3002/
```

### 6. 移动端适配

```html
<!-- 已有，但确认每个页面都有 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="mobile-web-app-capable" content="yes">
```

## 验证工具

- Google Rich Results Test（测 JSON-LD）
- PageSpeed Insights（测性能）
- 百度搜索资源平台（国内 SEO）

## 禁止事项

- 不要加隐藏关键词（关键词堆砌）
- 不要买外链（Google 会惩罚）
- 不要自动生成假评论（JSON-LD aggregateRating 不能造假数据）
- 不要加 `<meta http-equiv="refresh">` 跳转
