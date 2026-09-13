#!/bin/bash
# ============================================================
# 绿角犀官网 · 备案通过后 Nginx 回滚 + HTTPS 一键脚本
# 执行前提：lvjiaoxi.com ICP 备案通过 + DNS A 记录生效
# 用法：ssh -i C:\Users\Administrator\.ssh\greenrhino_deploy root@47.116.59.141 "bash -s" < rollback-nginx-https.sh
# ============================================================
set -euo pipefail

LOG="/var/log/lvjiaoxi-rollback-$(date +%Y%m%d%H%M%S).log"
exec 2>&1 | tee -a "$LOG"

echo "========== 绿角犀 Nginx 回滚 + HTTPS =========="
echo "时间: $(date)"
echo "日志: $LOG"

# ---------- 0. 前置检查 ----------
echo ""
echo "--- [0/6] 前置检查 ---"

if ! command -v nginx &>/dev/null; then
    echo "❌ nginx 未安装" && exit 1
fi
if ! command -v certbot &>/dev/null; then
    echo "⚠️  certbot 未安装，尝试 pip 安装..."
    pip3 install certbot python3-certbot-nginx 2>&1 | tail -3 || { echo "❌ certbot 安装失败" && exit 1; }
fi

# 验证 DNS 已解析
if ! getent hosts lvjiaoxi.com | grep -q "47.116.59.141"; then
    echo "⚠️  DNS 尚未生效（lvjiaoxi.com → 47.116.59.141），certbot 可能失败"
    echo "   继续执行 Nginx 回滚部分，HTTPS 签名请稍后手动跑 certbot"
    SKIP_CERTBOT=1
else
    echo "✅ DNS 已解析"
    SKIP_CERTBOT=0
fi

# ---------- 1. 回滚前备份 ----------
echo ""
echo "--- [1/6] 回滚前备份 ---"
TS=$(date +%Y%m%d%H%M%S)
cp /etc/nginx/conf.d/lvjiaoxi.conf    /etc/nginx/conf.d/lvjiaoxi.conf.before-rollback-$TS
cp /etc/nginx/conf.d/greenrhino-cloud.conf /etc/nginx/conf.d/greenrhino-cloud.conf.before-rollback-$TS
echo "✅ 已备份两个 conf 文件"

# ---------- 2. lvjiaoxi.conf 回滚 ----------
echo ""
echo "--- [2/6] lvjiaoxi.conf 回滚（去掉 IP 精确匹配 + default_server）---"
# 当前: listen 80 default_server; server_name lvjiaoxi.com www.lvjiaoxi.com 47.116.59.141;
# 目标: listen 80;              server_name lvjiaoxi.com www.lvjiaoxi.com;
sed -i 's/listen 80 default_server/listen 80/' /etc/nginx/conf.d/lvjiaoxi.conf
sed -i 's/server_name lvjiaoxi.com www.lvjiaoxi.com 47.116.59.141/server_name lvjiaoxi.com www.lvjiaoxi.com/' /etc/nginx/conf.d/lvjiaoxi.conf

echo "修改后 lvjiaoxi.conf 关键行："
grep -n 'listen\|server_name' /etc/nginx/conf.d/lvjiaoxi.conf

# ---------- 3. greenrhino-cloud.conf 回滚 ----------
echo ""
echo "--- [3/6] greenrhino-cloud.conf 回滚（恢复 default_server + IP 匹配）---"
BAK="/etc/nginx/conf.d/greenrhino-cloud.conf.bak.keep-ip"
if [ -f "$BAK" ]; then
    cp "$BAK" /etc/nginx/conf.d/greenrhino-cloud.conf
    echo "✅ 已从 $BAK 恢复"
else
    echo "⚠️  备份 $BAK 不存在，手动恢复..."
    sed -i 's/listen 80;/listen 80 default_server;/' /etc/nginx/conf.d/greenrhino-cloud.conf
    sed -i 's/server_name _;/server_name _ 47.116.59.141;/' /etc/nginx/conf.d/greenrhino-cloud.conf
fi

echo "修改后 greenrhino-cloud.conf 关键行："
grep -n 'listen\|server_name' /etc/nginx/conf.d/greenrhino-cloud.conf

# ---------- 4. Nginx 语法验证 + reload ----------
echo ""
echo "--- [4/6] Nginx 语法验证 + reload ---"
nginx -t 2>&1
echo ""
nginx -s reload 2>&1
echo "✅ reload 成功"

# ---------- 5. 路由验证 ----------
echo ""
echo "--- [5/6] 路由验证 ---"
echo -n "Host: lvjiaoxi.com → "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/ -H 'Host: lvjiaoxi.com'
echo -n "Host: www.lvjiaoxi.com → "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/ -H 'Host: www.lvjiaoxi.com'
echo -n "Host: 47.116.59.141 → "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/ -H 'Host: 47.116.59.141'
echo -n "无 Host → "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/

# ---------- 6. certbot 签 HTTPS ----------
if [ "$SKIP_CERTBOT" -eq 0 ]; then
    echo ""
    echo "--- [6/6] certbot 签 HTTPS ---"
    certbot --nginx -d lvjiaoxi.com -d www.lvjiaoxi.com --non-interactive --agree-tos --register-unsafely-without-email 2>&1 | tail -15 || {
        echo "⚠️  certbot 失败，手动重试命令："
        echo "   certbot --nginx -d lvjiaoxi.com -d www.lvjiaoxi.com"
    }

    # 签完再 reload + 验证 HTTPS
    nginx -s reload 2>&1 || true
    sleep 2
    echo ""
    echo "HTTPS 验证："
    echo -n "https://lvjiaoxi.com → "; curl -s -o /dev/null -w "%{http_code}\n" -k https://127.0.0.1/ -H 'Host: lvjiaoxi.com'
else
    echo ""
    echo "--- [6/6] DNS 未生效，跳过 certbot ---"
    echo "   DNS 生效后手动执行："
    echo "   certbot --nginx -d lvjiaoxi.com -d www.lvjiaoxi.com"
fi

echo ""
echo "========== 完成 =========="
echo "回滚前备份: /etc/nginx/conf.d/*before-rollback-$TS"
echo "运行日志: $LOG"
echo "如需回滚本次操作："
echo "  cp /etc/nginx/conf.d/lvjiaoxi.conf.before-rollback-$TS /etc/nginx/conf.d/lvjiaoxi.conf"
echo "  cp /etc/nginx/conf.d/greenrhino-cloud.conf.before-rollback-$TS /etc/nginx/conf.d/greenrhino-cloud.conf"
echo "  nginx -t && nginx -s reload"
