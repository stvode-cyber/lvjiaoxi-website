# 后端工程师 · Backend Dev

## 角色

绿角犀官网后端负责人，负责 Express 服务器、API、数据库和认证体系。

## 技术栈

- **Node.js 20** + **Express**（无 TypeScript，无 ORM）
- **better-sqlite3**（同步 API，单文件数据库）
- **认证**：scrypt 口令哈希 + HMAC-SHA256 签名 Token + 多管理员体系
- **部署**：PM2（fork 模式，端口 3002）+ Nginx 反代

## 负责文件

| 路径 | 职责 |
|------|------|
| `server/server.js` | Express 入口 + 中间件链 + 监听 |
| `server/routes.js` | 所有路由（公开 + 后台） |
| `server/auth.js` | Token 签发/校验 + 口令哈希 + 多管理员 |
| `server/db.js` | 数据库连接 + 建表（幂等） |
| `server/config.js` | 集中配置（端口/口令/密钥/域名） |
| `server/env.js` | `.env` 加载器（不覆盖已存在变量） |
| `server/backup.js` | SQLite WAL 安全备份 |

## 必须遵守

1. **数据库操作用同步 API**：`db.prepare(sql).run() / .get() / .all()`
2. **新增字段必须幂等**：`ALTER TABLE` 前先查 `PRAGMA table_info`
3. **Token 必须包含 `pwd_version`**：改口令后旧 token 立即失效
4. **静态托管白名单守卫**：db/auth/server/节点模块/.env/backups 一律 404
5. **登录防爆破**：`MAX_LOGIN_FAILS=5`，`LOGIN_LOCK_MS=5min`
6. **进程间通信**：多管理员用同一张 `admins` 表，不要硬编码 admin 用户
7. **错误响应格式**：`{ error: '中文描述', requestId: 'xxx' }`，HTTP 状态码正确

## API 路由速查

## API 路由速查（45 条，2026-09 更新）

### 公开接口（无需认证）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查（db ok + uptime） |
| GET | `/api/health/detail` | 详细健康检查（版本/内存/磁盘） |
| GET | `/api/products` | 产品列表 |
| GET | `/api/products/hot` | 热门产品 |
| GET | `/api/products/:id` | 产品详情 |
| GET | `/api/products/:id/feedback` | 产品反馈列表 |
| GET | `/api/products/:id/related` | 关联产品 |
| GET | `/api/categories` | 分类列表 |
| GET | `/api/announcement` | 公告列表 |
| POST | `/api/contact` | 留言提交 |
| POST | `/api/feedback` | 反馈提交 |
| POST | `/api/views` | 浏览记录（防刷） |
| POST | `/api/downloads` | 下载记录 |

### 后台接口（需 `Authorization: Bearer <token>`，*需 admin 角色）

#### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | 登录（必须 `{username, password}`） |
| PUT | `/api/admin/password` | 修改当前用户口令 |

#### 看板
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats` | 看板统计 |
| GET | `/api/admin/stats/trend` | 趋势数据 |
| GET | `/api/admin/sysinfo` | 服务器信息 |

#### 产品
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/products` | 产品列表 |
| POST | `/api/admin/products` | 新增产品 * |
| PUT | `/api/admin/products/:id` | 更新产品 * |
| DELETE | `/api/admin/products/:id` | 删除产品 * |
| POST | `/api/admin/products/bulk/status` | 批量改状态 * |
| POST | `/api/admin/products/bulk/category` | 批量改分类 * |
| POST | `/api/admin/products/bulk/delete` | 批量删除 * |
| POST | `/api/admin/products/import` | 批量导入 * |

#### 分类
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/categories` | 分类列表 |
| POST | `/api/admin/categories` | 新增分类 * |
| PUT | `/api/admin/categories/:id` | 更新分类 * |
| DELETE | `/api/admin/categories/:id` | 删除分类 * |

#### 公告
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/announcements` | 公告列表 |
| POST | `/api/admin/announcements` | 新增公告 * |
| PUT | `/api/admin/announcements/:id` | 更新公告 * |
| DELETE | `/api/admin/announcements/:id` | 删除公告 * |

#### 留言
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/contacts` | 留言列表 |
| DELETE | `/api/admin/contacts/:id` | 删除留言 * |
| PUT | `/api/admin/contacts/:id/status` | 改留言状态 * |
| POST | `/api/admin/contacts/batch-status` | 批量改状态 * |
| POST | `/api/admin/contacts/batch-delete` | 批量删除 * |

#### 反馈
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/feedback` | 反馈列表 |
| PUT | `/api/admin/feedback/:id` | 更新反馈 * |
| DELETE | `/api/admin/feedback/:id` | 删除反馈 * |

#### 管理员
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/admins` | 管理员列表 |
| POST | `/api/admin/admins` | 新增管理员 * |
| PUT | `/api/admin/admins/:id` | 更新管理员 * |
| DELETE | `/api/admin/admins/:id` | 删除管理员 * |

#### 运维
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/audit` | 审计日志 |
| GET | `/api/admin/accesslog` | 访问日志 |
| GET | `/api/admin/backup` | 备份列表 |
| POST | `/api/admin/upload` | 上传文件 * |
| GET | `/api/admin/maintenance` | 维护模式状态 |
| PUT | `/api/admin/maintenance` | 开启/关闭维护模式 * |

## 工作流程

```
1. 收到需求 → 确认是否需要新 API / 新表字段
2. 改 routes.js → 同步更新 auth.js / db.js / config.js
3. 本地测试 → node server/server.js + curl
4. 冒烟测试 → node tools/smoke-test.js
5. 提交 → 写清 API 变更 + 数据库变更
```

## 常见坑

- `ensureAdmins()` 只在空表时种种子 → 已存在的 admin 用户不会用新口令
- `env.js` 不覆盖已存在变量 → PM2 fork 模式 + `.env` 文件双保险
- SQLite WAL 模式 → 备份前必须 `PRAGMA wal_checkpoint`（backup.js 已处理）
- `req.body` 未校验 → express.json 默认 100KB，大 POST 会 413
