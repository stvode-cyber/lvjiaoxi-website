# 单元测试规范

## 触发条件
新增/修改后端逻辑时、修复 bug 时、或用户说"写点测试"时使用。

## 项目现状
- **无正式单元测试框架**：用 Node 内置 `assert` + `node:test`
- **冒烟测试**：`tools/smoke-test.js`（747 项端到端）
- **测试目录**：建议新建 `tests/` 目录

## 测试文件组织
```
tests/
├── auth.test.js        # token / 口令哈希
├── env.test.js         # .env 解析
├── config.test.js      # 环境变量覆盖
├── db.test.js          # 建表幂等
├── i18n.test.js        # 国际化 key 查找
└── smoke/              # 冒烟测试（已有 tools/smoke-test.js）
```

## 编写规范

### 1. 零外部依赖
```js
// tests/auth.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// 直接 require 被测模块，mock db
const auth = require('../server/auth');
```

### 2. Fixture 隔离
```js
// 每个测试用临时 DB 或 mock
const tmpDb = require('better-sqlite3')(':memory:');
// ... 用完丢弃
```

### 3. 测试命名
```js
// 函数名_场景_预期结果
test('verifyPassword_正确口令_返回user对象', () => { ... });
test('verifyPassword_错误口令_返回null', () => { ... });
test('verifyPassword_空username_返回null', () => { ... });
test('verifyPassword_类型错误_返回null', () => { ... });
```

### 4. 必须覆盖的边界
- 空输入 / null / undefined
- 超长输入（数据库字段上限）
- 类型错误（数字当字符串传）
- 并发安全（多管理员同时登录）
- 过期 Token / 错误签名 Token / pwd_version 不匹配

## 运行方式
```bash
# 跑所有单元测试
node --test tests/

# 跑冒烟测试
node tools/smoke-test.js

# 跑生产冒烟
ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://127.0.0.1:3002
```

## 冒烟测试维护
- 新增 API → 同步加冒烟用例
- 修改 API 契约 → 同步改冒烟断言
- **冒烟不通过 = 不允许合入**
- 冒烟是隐式的 API 契约文档，代码改了冒烟必须跟着改

## 禁止事项
- 不要引入 jest/vitest/mocha（保持极简）
- 不要用 console.log 代替 assert
- 不要让测试依赖外部网络
- 不要在测试里硬编码生产口令
- 不要为了让冒烟通过而修改冒烟代码（应该改业务代码）

## 常见坑速查

| 现象 | 根因 | 修复 |
|------|------|------|
| 冒烟测试在本地过但生产挂 | 本地 `.env` 设了 ADMIN_PASSWORD 但生产没生效 | 生产用 `ADMIN_PASSWORD='xxx' node smoke-test.js` 显式传 |
| 冒烟 747 项突然少了几项 | 忘了同步改 smoke-test.js | 改了 routes.js 必须改 smoke-test.js 的对应断言 |
| 冒烟报 401 | 登录接口漏了 username 字段 | 必须 `{username:'admin', password:'xxx'}` |
| 冒烟报数据库表不存在 | 忘了 migrate | 改了 db.js 的建表逻辑后，生产数据库也要迁移 |
| 生产冒烟改密码后本地登不上 | ensureAdmins 只在空表时 seed | 用 scrypt 重置数据库里的 admin hash |
