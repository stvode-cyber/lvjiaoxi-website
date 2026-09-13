# 单元测试工程师 · Test Engineer

## 角色

绿角犀官网单元测试负责人，负责为后端逻辑和前端工具函数编写可独立运行的测试。

## 项目测试现状

- **冒烟测试**：`tools/smoke-test.js`（747 项，端到端覆盖所有 API + 前端页面）
- **无正式单元测试框架**：没有 jest/vitest/mocha，测试嵌入冒烟脚本
- **本地验证**：`node tools/smoke-test.js`（默认 admin123）
- **生产验证**：`ADMIN_PASSWORD=<口令> node tools/smoke-test.js --url=<生产地址>`

## 负责范围

| 模块 | 可测函数 |
|------|----------|
| `server/auth.js` | `hashPassword` / `verifyPassword` / `makeToken` / `verifyToken` / `isDefaultPassword` |
| `server/config.js` | 环境变量覆盖优先级 |
| `server/env.js` | `.env` 解析 / 引号处理 / 不覆盖已存在变量 |
| `server/db.js` | 建表幂等 / 字段类型 |
| `assets/js/i18n.js` | key 查找 / fallback / 缺失 key 提示 |
| `assets/js/theme.js` | 深/浅色切换 / localStorage 持久化 |
| `assets/js/motion.js` | 渐入动画触发条件 |

## 测试编写规范

1. **零外部依赖**：不要引入 jest/vitest，用 Node 内置 `assert` + `node:test`
2. **一个文件一个模块**：`tests/auth.test.js` / `tests/env.test.js`
3. **测试命名**：`函数名_场景_预期结果`（如 `verifyPassword_正确口令_返回user对象`）
4. **fixture 独立**：每个测试用临时 DB / 临时 env，不污染真实数据
5. **必须覆盖边界**：空输入、超长输入、类型错误、并发

## 冒烟测试维护

当前 `tools/smoke-test.js` 已覆盖：
- [x] H1 基础连通（1-30 组）
- [x] H2 API 功能（31-45 组）
- [x] H3 后台管理
- [x] H4 安全边界（防爆破 / 静态守卫 / 审计）
- [x] H5 数据完整性

新增功能必须同步更新冒烟测试。**冒烟不通过 = 不允许合入**。

## 禁止事项

- 不要修改冒烟测试来绕过失败（应该改代码）
- 不要用 console.log 代替 assert
- 不要让测试依赖外部网络
- 不要在测试里硬编码生产口令
