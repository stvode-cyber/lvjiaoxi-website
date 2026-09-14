#!/bin/bash
# lvjiaoxi-nginx-guard.sh — 每 5 分钟检查 lvjiaoxi.conf，不存在则从备份恢复
# cron: */5 * * * * /usr/local/bin/lvjiaoxi-nginx-guard.sh >> /var/log/lvjiaoxi-guard.log 2>&1
set -uo pipefail

CONF=/etc/nginx/conf.d/lvjiaoxi.conf
BACKUP=/etc/nginx/conf.d/lvjiaoxi.conf.bak.with-ip
LOG=/var/log/lvjiaoxi-guard.log
TS=$(date '+%Y-%m-%d %H:%M:%S')

# 配置文件存在，正常退出
if [ -f "$CONF" ]; then
    exit 0
fi

# 配置文件丢失！记录日志 + 恢复
echo "[$TS] ALERT: lvjiaoxi.conf 丢失！尝试从 $BACKUP 恢复" >> "$LOG"

# 检查备份是否存在
if [ ! -f "$BACKUP" ]; then
    echo "[$TS] FATAL: 备份 $BACKUP 也不存在，无法恢复！" >> "$LOG"
    exit 1
fi

# 解锁（如果之前有 chattr +i）
chattr -i "$CONF" 2>/dev/null || true

# 恢复配置
cp "$BACKUP" "$CONF"
chmod 644 "$CONF"

# 加文件锁防删
chattr +i "$CONF" 2>/dev/null || true

# 验证 Nginx 配置
if nginx -t 2>/dev/null; then
    nginx -s reload 2>/dev/null
    echo "[$TS] RECOVERED: lvjiaoxi.conf 已恢复 + Nginx 已重载" >> "$LOG"
else
    echo "[$TS] ERROR: nginx -t 失败，恢复的配置有问题！" >> "$LOG"
    exit 1
fi
