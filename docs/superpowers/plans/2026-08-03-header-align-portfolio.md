# 钉钉扫码打卡顶栏对齐个人网站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让钉钉扫码打卡在登录、已登录和维护状态下使用与个人网站相同宽度和外观的顶栏，并删除所有 `SWU Campus` 文案。

**Architecture:** 继续由 `components/app-shell.tsx` 内的 `SiteHeader` 统一服务三种页面状态，但让顶栏自行负责吸顶定位、响应式页边距和 `max-w-5xl` 内容宽度。各业务主体保留原有 `max-w-lg`、`max-w-3xl` 或 `max-w-4xl` 约束，避免顶栏对齐影响二维码和业务卡片布局。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tailwind CSS 4、Vitest、React DOM 服务端静态渲染

---

## 文件结构

- 修改 `components/app-shell.test.tsx`：增加顶栏宽度、外观类名及英文文案移除的回归约束。
- 修改 `components/app-shell.tsx`：同步品牌区和顶栏布局，分离顶栏与各页面主体宽度，删除维护页英文文案。
- 不新增运行时代码文件或依赖。

### Task 1: 增加顶栏视觉回归测试

**Files:**
- Modify: `components/app-shell.test.tsx:103-114`
- Test: `components/app-shell.test.tsx`

- [x] **Step 1: 扩展现有顶栏测试并建立失败基线**

将“顶栏使用站点图标并显示扫码打卡品牌文字”测试扩展为以下断言：

```tsx
it("顶栏与个人网站同宽并只显示中文品牌文字", () => {
  const html = renderToStaticMarkup(
    AppShell({
      serviceEnabled: false,
      initialPayload: { stage: "unauthenticated" },
    }),
  );

  expect(html).toContain('src="/icon.svg"');
  expect(html).toContain("SWU钉钉扫码打卡");
  expect(html).not.toContain("西大寝签");
  expect(html).not.toContain("SWU Campus");
  expect(html).toMatch(
    /<header[^>]*class="[^"]*sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4[^"]*">/,
  );
  expect(html).toMatch(
    /<header[\s\S]*?<div[^>]*class="[^"]*mx-auto[^"]*h-14[^"]*w-full[^"]*max-w-5xl[^"]*sm:h-16[^"]*">/,
  );
});
```

- [x] **Step 2: 运行单个测试文件并确认新断言失败**

Run: `pnpm test -- components/app-shell.test.tsx`

Expected: FAIL；现有顶栏没有 `sticky top-0` 和 `max-w-5xl`，且维护页仍渲染 `SWU Campus`。

### Task 2: 对齐顶栏结构并调整三种页面布局

**Files:**
- Modify: `components/app-shell.tsx:127-167`
- Modify: `components/app-shell.tsx:208-274`
- Modify: `components/app-shell.tsx:419-555`
- Modify: `components/app-shell.tsx:559-576`
- Test: `components/app-shell.test.tsx`

- [x] **Step 1: 将品牌区改为个人网站式单行中文品牌**

用以下实现替换 `Brand`，删除两行品牌中的 `SWU Campus`，并将图标统一为 28px：

```tsx
function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-semibold tracking-[0.04em]">
      <Image src="/icon.svg" alt="" width={28} height={28} aria-hidden />
      <span>SWU钉钉扫码打卡</span>
    </div>
  );
}
```

- [x] **Step 2: 让顶栏自行承担与个人网站一致的页面级布局**

将 `SiteHeader` 的外层和内容区类名调整为：

```tsx
function SiteHeader({ status, actions }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 rounded-full border border-white/60 bg-background/80 px-2.5 shadow-[var(--shadow-neumorphic)] backdrop-blur-xl sm:h-16 sm:px-3">
        <Brand />
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">{status}</span>
          <Badge
            aria-hidden="true"
            variant="outline"
            className="hidden border-primary/20 bg-background/60 text-muted-foreground sm:inline-flex"
          >
            {status}
          </Badge>
          {actions}
        </div>
      </div>
    </header>
  );
}
```

- [x] **Step 3: 分离登录页顶栏与主体宽度**

保持当前 JSX 子节点顺序，只替换登录页根节点、直属容器和主体区的三个 `className`：

```tsx
className="min-h-dvh"
className="flex min-h-dvh flex-col"
className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-3 py-12 sm:px-6 sm:py-16"
```

`SiteHeader` 仍是直属容器的第一个子元素，登录内容的其余元素和事件处理不变。

- [x] **Step 4: 分离已登录页顶栏与主体宽度**

将 `Dashboard` 根节点替换为以下类名：

```tsx
className="min-h-dvh"
```

把现有完整的 `SiteHeader` 元素移到 `max-w-4xl` 容器之前，不修改其 `status`、刷新按钮或退出按钮。随后将原 `max-w-4xl` 容器开标签放在 `SiteHeader` 结束标签之后，并使用：

```tsx
<div className="mx-auto w-full max-w-4xl px-3 sm:px-6">
```

现有 `<main className="w-full px-1 py-8 sm:px-2 sm:py-12">` 及其全部业务内容保持在该容器内。

- [x] **Step 5: 分离维护页顶栏与主体宽度并删除英文文案**

保持维护页的 `SiteHeader` 和主体结构，替换根节点、直属容器和主体区的类名：

```tsx
className="min-h-dvh"
className="flex min-h-dvh flex-col"
className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-3 py-16 text-center sm:px-6"
```

删除包含 `SWU Campus` 的整个 `<p>` 元素，并把其后标题的类名从 `mt-3` 改为 `mt-8`：

```tsx
<h1 className="mt-8 text-3xl font-semibold sm:text-4xl">服务暂未开放</h1>
```

- [x] **Step 6: 运行相关测试并确认通过**

Run: `pnpm test -- components/app-shell.test.tsx`

Expected: PASS；顶栏回归测试与客户端会话测试全部通过。

### Task 3: 执行项目级验证

**Files:**
- Verify: `components/app-shell.tsx`
- Verify: `components/app-shell.test.tsx`

- [x] **Step 1: 检查英文文案已完全移除**

Run: `rg -n "SWU Campus" components/app-shell.tsx app`

Expected: 无匹配，命令退出码为 1。

- [x] **Step 2: 运行 ESLint**

Run: `pnpm lint`

Expected: PASS，退出码为 0。

- [x] **Step 3: 运行 TypeScript 类型检查**

Run: `pnpm typecheck`

Expected: PASS，退出码为 0。

- [x] **Step 4: 运行完整测试套件**

Run: `pnpm test`

Expected: PASS，所有 Vitest 测试通过。

- [x] **Step 5: 运行生产构建**

Run: `pnpm build`

Expected: PASS，Next.js 完成生产构建且退出码为 0。

- [x] **Step 6: 检查最终差异和工作区状态**

Run: `git diff --check && git status --short`

Expected: `git diff --check` 无输出；状态中只包含本任务的设计说明、实施计划、`components/app-shell.tsx` 和 `components/app-shell.test.tsx`。按用户规则不创建提交。
