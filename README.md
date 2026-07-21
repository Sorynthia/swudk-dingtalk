# 西大寝签

基于 Next.js 与 shadcn/ui 的西南大学钉钉扫码登录、住宿信息查询及临时签到页面。项目将原有 Python 脚本中的流程迁移到了 Next.js 服务端，浏览器只接收二维码、登录状态和脱敏后的学生信息。

## 技术栈

- Next.js 16（App Router、Route Handler）
- React 19、TypeScript
- Tailwind CSS 4
- shadcn/ui、Lucide
- pnpm 11

## 本地运行

需要 Node.js 20.9 或更高版本。

```bash
pnpm install
cp .env.example .env
pnpm dev
```

编辑 `.env`，将 `APP_ORIGIN` 设置为浏览器实际访问的来源，末尾不要添加 `/`；`PORT` 控制开发和生产服务的监听端口。`SESSION_SECRET` 是必填的会话加密密钥，应使用 `openssl rand -base64 32` 生成。`pnpm dev` 与 `pnpm start` 会在启动 Next.js 前自动加载该文件。

```env
APP_ORIGIN=https://example.com
PORT=3001
SESSION_SECRET=请替换为至少32字符的随机密钥
```

生产环境先执行 `pnpm build`，再执行 `pnpm start`。示例配置对应端口为 `3001`。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 实现说明

- `src/lib/dingtalk.ts` 负责二维码生成、状态轮询、授权回调和校内 token 交换。
- `src/lib/swu.ts` 负责查询学号、住宿信息、请假与临时签到状态，并提交用户主动触发的签到。
- `src/lib/session-store.ts` 使用不可读的 `HttpOnly` Cookie 关联服务端会话；token 和必要学生资料使用 AES-256-GCM 加密保存在本机 `.data` 目录。恢复后的实际有效期由校内登录状态决定。
- `src/app/api` 提供二维码、轮询、会话、信息刷新与临时签到接口。

临时签到只会在用户点击“执行临时签到”后提交。实现依据当前接口约定，使用 `getDormitory` 返回的 `data.columnList`：第 1 项提供登记经纬度，第 2 项提供住宿地址，第 3 项提供签到半径。若校内接口字段顺序发生变化，需要同步更新 `src/lib/swu.ts` 中的字段读取逻辑。

未登录时不会自动生成二维码。页面只检查本机会话，用户点击“生成登录二维码”后才会请求钉钉登录服务。同一会话会复用仍有效的二维码；移动端切到钉钉或标签页进入后台后会暂停新轮询，返回页面、恢复网络或从浏览器缓存恢复时立即查询登录状态。短暂的网络和上游失败不会丢失当前二维码，扫码流程结束后立即清理二维码、临时 Cookie 和跳转参数。

会话密文默认保存在项目根目录的 `.data`，校内 token 和必要学生资料使用 `SESSION_SECRET` 派生的 AES-256-GCM 密钥加密。`SESSION_SECRET` 只保存在未提交的 `.env` 或部署平台密钥配置中；项目不再创建或读取任何密钥文件。可以用 `SESSION_DATA_DIR` 覆盖会话目录。退出登录会同步删除对应的会话文件；更换密钥或遇到不兼容会话时需要重新扫码。

所有使用 Cookie 鉴权的写接口都会校验请求 `Origin`。反向代理部署时若应用看到的内部 Origin 与公开地址不同，应将 `APP_ORIGIN` 设置为完整公开来源，例如 `https://example.com`。

前端只接收学号、住宿地址和签到半径；登记坐标等签到内部字段仅在服务端读取。签到保存后会再次查询状态，只有确认 `qdzt` 为“已签到”才向页面报告成功。

当前持久化方式适合本地或单实例部署。多实例或 Serverless 环境应改用带过期策略的共享加密存储，并通过部署平台安全管理 `SESSION_SECRET`。
