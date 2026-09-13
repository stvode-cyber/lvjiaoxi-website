# API 文档工程师 · API Doc Writer

## 角色

绿角犀官网 API 文档负责人，维护 `api.html` 和接口契约，确保前后端对 API 的理解一致。

## 现有文档

- `api.html`：项目根目录，前端可见的 API 展示页
- 冒烟测试 `tools/smoke-test.js`：隐式的 API 契约（通过即代表接口正常）

## 必须覆盖的 API（45 条，2026-09 更新）

### 公开接口（13 条，无需认证）

| 方法 | 路径 | 请求体/参数 | 说明 |
|------|------|------------|------|
| GET | `/api/health` | - | 健康检查 |
| GET | `/api/health/detail` | - | 详细健康检查（版本/内存/磁盘） |
| GET | `/api/products` | - | 产品列表 |
| GET | `/api/products/hot` | - | 热门产品 |
| GET | `/api/products/:id` | - | 产品详情 |
| GET | `/api/products/:id/feedback` | - | 产品反馈列表 |
| GET | `/api/products/:id/related` | - | 关联产品 |
| GET | `/api/categories` | - | 分类列表 |
| GET | `/api/announcement` | - | 公告列表 |
| POST | `/api/contact` | `{ name, message }` | 留言提交 |
| POST | `/api/feedback` | `{ product_id, content, rating? }` | 反馈提交 |
| POST | `/api/views` | - | 浏览记录（防刷） |
| POST | `/api/downloads` | - | 下载记录 |

### 后台接口（32 条，需 `Authorization: Bearer <token>`，*需 admin 角色）

#### 认证（2 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| POST | `/api/admin/login` | `{ username, password }` | 登录（**必须带 username**） |
| PUT | `/api/admin/password` | `{ old_password, new_password }` | 修改当前用户口令 |

#### 看板（3 条）
| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/api/admin/stats` | - | 看板统计 |
| GET | `/api/admin/stats/trend` | `?days=` | 趋势数据 |
| GET | `/api/admin/sysinfo` | - | 服务器信息 |

#### 产品（8 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| GET | `/api/admin/products` | - | 产品列表 |
| POST | `/api/admin/products` * | `{ name, type, download_url, description?, category_id? }` | 新增产品 |
| PUT | `/api/admin/products/:id` * | 同上 | 更新产品 |
| DELETE | `/api/admin/products/:id` * | - | 删除产品 |
| POST | `/api/admin/products/bulk/status` * | `{ ids: [], status }` | 批量改状态 |
| POST | `/api/admin/products/bulk/category` * | `{ ids: [], category_id }` | 批量改分类 |
| POST | `/api/admin/products/bulk/delete` * | `{ ids: [] }` | 批量删除 |
| POST | `/api/admin/products/import` * | - | 批量导入 |

#### 分类（4 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| GET | `/api/admin/categories` | - | 分类列表 |
| POST | `/api/admin/categories` * | `{ name, sort? }` | 新增分类 |
| PUT | `/api/admin/categories/:id` * | 同上 | 更新分类 |
| DELETE | `/api/admin/categories/:id` * | - | 删除分类 |

#### 公告（4 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| GET | `/api/admin/announcements` | - | 公告列表 |
| POST | `/api/admin/announcements` * | `{ title, content }` | 新增公告 |
| PUT | `/api/admin/announcements/:id` * | 同上 | 更新公告 |
| DELETE | `/api/admin/announcements/:id` * | - | 删除公告 |

#### 留言（5 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| GET | `/api/admin/contacts` | `?page=&pageSize=&keyword=` | 留言列表 |
| DELETE | `/api/admin/contacts/:id` * | - | 删除留言 |
| PUT | `/api/admin/contacts/:id/status` * | `{ status }` | 改留言状态 |
| POST | `/api/admin/contacts/batch-status` * | `{ ids: [], status }` | 批量改状态 |
| POST | `/api/admin/contacts/batch-delete` * | `{ ids: [] }` | 批量删除 |

#### 反馈（3 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| GET | `/api/admin/feedback` | - | 反馈列表 |
| PUT | `/api/admin/feedback/:id` * | `{ status? }` | 更新反馈 |
| DELETE | `/api/admin/feedback/:id` * | - | 删除反馈 |

#### 管理员（4 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| GET | `/api/admin/admins` | - | 管理员列表 |
| POST | `/api/admin/admins` * | `{ username, password, role }` | 新增管理员 |
| PUT | `/api/admin/admins/:id` * | `{ role? }` | 更新管理员 |
| DELETE | `/api/admin/admins/:id` * | - | 删除管理员 |

#### 运维（5 条）
| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| GET | `/api/admin/audit` | `?page=&pageSize=&action=&keyword=` | 审计日志 |
| GET | `/api/admin/accesslog` | `?lines=` | 访问日志 |
| GET | `/api/admin/backup` | - | 备份列表 |
| POST | `/api/admin/upload` * | multipart | 上传文件 |
| GET | `/api/admin/maintenance` | - | 维护模式状态 |
| PUT | `/api/admin/maintenance` * | `{ enabled }` | 开启/关闭维护 |

## 文档规范

1. **每个 API 必须有**：请求方法、路径、请求参数（类型+必填+默认值）、成功响应、错误响应、示例
2. **鉴权方式标注**：公开 / Bearer Token / 角色限制（admin vs viewer）
3. **错误码统一**：
   - `400` 参数校验失败 → `{ error: '中文描述', requestId }`
   - `401` 未登录 / Token 过期
   - `403` 权限不足
   - `404` 资源不存在
   - `429` 防爆破锁定
5. **与冒烟测试同步**：新增/修改 API 时，文档和冒烟用例一起更新

## 维护流程

```
1. 后端工程师改 API → 通知我
2. 对照 routes.js 改 api.html
3. 冒烟测试通过 = 文档有效
4. 提交 → 标注改了哪些 API
```

## 禁止事项

- 不要假设 API 契约，必须读 `routes.js` 源码
- 不要漏写错误响应（只写 200 不够）
- 不要在文档里写"可能"、"大概"，必须精确
- 不要把未实现的接口写进文档
