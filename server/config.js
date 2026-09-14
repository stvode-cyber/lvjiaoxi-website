// 集中配置：上线前在此或环境变量中修改口令与端口
module.exports = {
  // 后台管理员口令（默认管理员 admin 的初始口令）。优先级：环境变量 ADMIN_PASSWORD > 此处默认值
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  // Token 签名密钥：多管理员体系下用于签发/校验无状态 Token。务必通过环境变量 AUTH_SECRET 设置强随机值
  authSecret: process.env.AUTH_SECRET || 'lvjx-default-auth-secret-please-change',
  // 服务端口。优先级：环境变量 PORT > 此处默认值
  port: process.env.PORT || 3000,
  // 站点正式域名（用于 sitemap / robots / 分享链接）。优先级：环境变量 SITE_URL > 此处默认值
  // 上线时改为真实域名，例如 https://www.lvjiaoxi.com
  siteUrl: process.env.SITE_URL || 'https://lvjiaoxi.com',
};
