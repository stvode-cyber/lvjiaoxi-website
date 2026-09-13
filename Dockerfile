# 绿角犀官网 — 容器化构建
# 多阶段：build 阶段编译 better-sqlite3 原生模块，runtime 阶段仅保留运行所需。
FROM node:22-slim AS build

# better-sqlite3 需要本地编译工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY . .

# 运行阶段：复用已编译的依赖，去掉构建工具减小体积
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

# 运行时数据（SQLite / 备份 / 日志）落在挂载卷，避免写进镜像层
VOLUME ["/app/data"]

# 仅暴露应用端口；TLS 由前置 nginx 负责
EXPOSE 3000

# 启动前确保管理员表与默认账号存在
CMD ["node", "server/server.js"]
