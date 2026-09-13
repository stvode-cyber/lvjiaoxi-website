// PM2 进程守护配置
// 用法：在项目根目录执行 `pm2 start deploy/ecosystem.config.js`
// 开机自启：先 `pm2 save`，再 `pm2 startup`（按提示执行生成的命令）
module.exports = {
  apps: [
    {
      name: 'lvjiaoxi-website',
      script: 'server/server.js',
      cwd: '/opt/lvjiaoxi', // 部署时改为实际项目绝对路径
      instances: 1, // 单实例即可；如需多核可改为 'max'
      autorestart: true,
      watch: false, // 生产关闭文件监听，避免误重启
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // 以下三项上线前务必替换为真实值（AUTH_SECRET 生成方式见 .env.example）
        SITE_URL: 'https://lvjiaoxi.com',
        ADMIN_PASSWORD: '__CHANGE_ME__',
        AUTH_SECRET: '__CHANGE_ME__',
      },
    },
  ],
};
