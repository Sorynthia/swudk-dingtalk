# 钉钉扫码打卡

面向西南大学校园场景的钉钉扫码打卡工具。基于 Next.js App Router 实现前后端一体化，所有认证和打卡逻辑在服务端处理，浏览器只接收二维码、登录状态和脱敏后的学生信息。

> 本项目不是学校官方系统。打卡结果应以目标校园系统的实际记录为准。

## 核心功能

- 按需生成钉钉登录二维码并轮询授权状态
- 查询学号、住宿地址、打卡半径和当前打卡状态
- 提交临时打卡请求

## 技术栈

- **框架**: Next.js 15 (App Router + API Routes)
- **UI**: shadcn/ui + Tailwind CSS
- **状态管理**: React Hooks
- **构建工具**: Turbopack
- **包管理**: pnpm

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3000

### 3. 生产构建

```bash
pnpm build
pnpm start
```

## 项目结构

```
.
├── app/
│   ├── layout.tsx         # 根布局
│   ├── page.tsx           # 前端页面
│   └── api/               # 服务端 API Routes
│       ├── auth/          # 认证接口
│       ├── check-in/      # 打卡接口
│       └── profile/       # 用户信息接口
├── components/
│   └── ui/               # shadcn/ui 组件
├── lib/                  # 工具函数
└── public/               # 静态资源
```

## 部署

支持 Vercel、Netlify 等 Node.js 平台一键部署。

### Vercel 部署

```bash
pnpm vercel
```

### Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
```

## 注意事项

- ⚠️ 本项目仅用于技术研究和学习
- ⚠️ 请遵守学校相关规定，不要用于违规用途
- ⚠️ 打卡结果应以官方系统为准
- ⚠️ 生产环境需要配置 HTTPS 和安全策略

## 相关项目

- **[swu-checkin](https://github.com/Sorynthia/swu-checkin)** - 钉钉查寝自动打卡脚本
- **[swu-login](https://github.com/Sorynthia/swu-login)** - 西南大学统一身份认证独立登录模块

## 贡献指南

欢迎提交 Issue 和 Pull Request！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详细信息。

## 引用与归属

如果你在项目中使用或参考了本代码，建议按以下方式标注：

```
基于 Sorynthia/swudk-dingtalk 开发
GitHub: https://github.com/Sorynthia/swudk-dingtalk
```

本项目采用 MIT 许可证，欢迎使用和修改，但请保留原作者信息。

## 许可证

MIT License