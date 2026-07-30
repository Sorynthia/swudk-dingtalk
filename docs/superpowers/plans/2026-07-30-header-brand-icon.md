# 顶栏品牌图标替换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 将现有 favicon 显示在顶栏左上角，并把品牌主文字改为“钉钉扫码打卡”。

**架构：** 仅修改 `Brand` 展示组件，复用 Next.js App Router 暴露的 `/icon.svg` 资源。保留既有容器样式、辅助品牌文字和响应式布局，不改变会话或业务逻辑。

**技术栈：** Next.js 16、React 19、TypeScript、`next/image`、Vitest。

---

### 任务 1：修改顶栏品牌展示

**文件：**
- 修改：`src/components/app-shell.tsx` 的 `Brand` 组件及图标导入

- [ ] 删除不再使用的 `GraduationCap` 导入。
- [ ] 在现有图标容器中使用 `Image` 显示 `src="/icon.svg"`，设置 `alt=""`、`width={40}`、`height={40}`，并保留现有尺寸类。
- [ ] 将品牌主文字改为“钉钉扫码打卡”。

### 任务 2：补充展示回归测试

**文件：**
- 修改：`src/components/app-shell.test.tsx`

- [ ] 增加对 `Brand` 或 `SiteHeader` 输出的测试，断言渲染结果包含“钉钉扫码打卡”和 `/icon.svg`，不包含“西大寝签”。测试使用当前文件已有的函数式组件渲染方式，避免引入新的测试依赖。

### 任务 3：执行验证

**文件：** 无

- [ ] 运行 `pnpm exec vitest run src/components/app-shell.test.tsx`，预期通过。
- [ ] 运行 `pnpm run typecheck`，预期无 TypeScript 错误。
- [ ] 运行 `pnpm run lint`，预期无 ESLint 错误。
