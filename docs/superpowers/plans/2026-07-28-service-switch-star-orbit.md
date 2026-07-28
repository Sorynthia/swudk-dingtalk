# 服务开关与星轨风格改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加默认关闭的 `SERVICE_ENABLED` 服务开关，并将登录、维护和已登录页面统一改造成参考本地 portfolio 的暖色星轨风格。

**Architecture:** 使用仅服务端可导入的状态模块集中解析环境变量，并由独立 HTTP 辅助函数生成统一 `503` 响应。页面在读取 Cookie 或访问校内服务前短路到维护界面，所有业务 Route Handler 在业务逻辑前短路，退出接口保留；视觉层在现有组件与 Tailwind 变量上做聚焦改造，不引入新依赖。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Tailwind CSS 4、shadcn/ui、Lucide、Vitest 4、pnpm 11。

**Git 约束:** 根据用户全局指令，本计划执行期间不创建分支、不提交、不推送；每个任务结束只检查 `git diff` 与测试结果。

---

## 文件结构

- Create: `src/lib/service-status.ts` — 解析并读取服务开关，导出统一关闭文案。
- Create: `src/lib/service-status.test.ts` — 覆盖环境变量解析边界。
- Create: `src/lib/service-http.ts` — 生成业务 API 的统一 `503` JSON 响应。
- Create: `src/app/api/service-disabled-routes.test.ts` — 验证全部业务接口关闭时短路，退出接口例外。
- Modify: `src/app/page.tsx` — 在 Cookie 与上游访问前处理关闭状态。
- Modify: `src/components/app-shell.tsx` — 增加维护界面并重塑登录、信息页视觉。
- Modify: `src/components/app-shell.test.tsx` — 覆盖维护状态渲染与客户端会话回归。
- Modify: `src/app/api/auth/qr/route.ts` — 二维码生成关闭保护。
- Modify: `src/app/api/auth/status/route.ts` — 登录轮询关闭保护。
- Modify: `src/app/api/auth/session/route.ts` — 会话读取关闭保护，退出继续可用。
- Modify: `src/app/api/profile/route.ts` — 资料刷新关闭保护。
- Modify: `src/app/api/check-in/route.ts` — 签到查询和提交关闭保护。
- Modify: `src/components/ui/button.tsx` — 新增新拟态按钮变体。
- Modify: `src/app/globals.css` — 引入暖色变量、星轨、星芒与减弱动画规则。
- Modify: `src/app/layout.tsx` — 更新浏览器主题色。
- Modify: `.env.example`、`README.md` — 记录默认关闭及开启方式。

### Task 1: 服务开关解析

**Files:**
- Create: `src/lib/service-status.test.ts`
- Create: `src/lib/service-status.ts`

- [ ] **Step 1: 编写失败测试**

```ts
import { afterEach, describe, expect, it } from "vitest";

import { isServiceEnabled, parseServiceEnabled } from "@/lib/service-status";

describe("服务开关", () => {
  const originalValue = process.env.SERVICE_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.SERVICE_ENABLED;
    else process.env.SERVICE_ENABLED = originalValue;
  });

  it.each([
    ["true", true],
    [" TRUE ", true],
    ["false", false],
    ["1", false],
    ["", false],
    [undefined, false],
  ])("将 %s 解析为 %s", (value, expected) => {
    expect(parseServiceEnabled(value)).toBe(expected);
  });

  it("每次调用时读取当前服务端环境变量", () => {
    process.env.SERVICE_ENABLED = "true";
    expect(isServiceEnabled()).toBe(true);
    process.env.SERVICE_ENABLED = "false";
    expect(isServiceEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: 验证测试因模块缺失而失败**

Run: `pnpm test src/lib/service-status.test.ts`

Expected: FAIL，提示无法解析 `@/lib/service-status`。

- [ ] **Step 3: 编写最小实现**

```ts
import "server-only";

export const SERVICE_DISABLED_MESSAGE = "服务暂未开放，请稍后再试";

export function parseServiceEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isServiceEnabled() {
  return parseServiceEnabled(process.env.SERVICE_ENABLED);
}
```

- [ ] **Step 4: 验证测试通过**

Run: `pnpm test src/lib/service-status.test.ts`

Expected: PASS。

### Task 2: 全部业务 API 的关闭保护

**Files:**
- Create: `src/lib/service-http.ts`
- Create: `src/app/api/service-disabled-routes.test.ts`
- Modify: `src/app/api/auth/qr/route.ts`
- Modify: `src/app/api/auth/status/route.ts`
- Modify: `src/app/api/auth/session/route.ts`
- Modify: `src/app/api/profile/route.ts`
- Modify: `src/app/api/check-in/route.ts`

- [ ] **Step 1: 编写覆盖所有路由的失败测试**

测试文件统一 mock `next/headers`、`@/lib/dingtalk`、`@/lib/swu`、`@/lib/session-store` 和 `@/lib/session-http`，然后导入六个业务处理器与退出处理器：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  deleteLoginSession: vi.fn(),
  getLoginSession: vi.fn(),
  getCheckInStatus: vi.fn(),
  getStudentProfile: vi.fn(),
  pollDingTalkLogin: vi.fn(),
  startDingTalkLogin: vi.fn(),
  submitCheckIn: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: "old-session" })),
    set: mocks.cookieSet,
  })),
}));
vi.mock("@/lib/dingtalk", () => ({
  pollDingTalkLogin: mocks.pollDingTalkLogin,
  startDingTalkLogin: mocks.startDingTalkLogin,
}));
vi.mock("@/lib/session-store", () => ({
  SESSION_COOKIE: "swu_portal_session",
  deleteLoginSession: mocks.deleteLoginSession,
  getLoginSession: mocks.getLoginSession,
  getSessionCookieOptions: vi.fn(() => ({})),
  persistAuthenticatedSession: vi.fn(),
}));
vi.mock("@/lib/session-http", () => ({
  invalidateSession: vi.fn(),
  isSameOriginRequest: vi.fn(() => true),
}));
vi.mock("@/lib/swu", () => ({
  getCheckInStatus: mocks.getCheckInStatus,
  getStudentProfile: mocks.getStudentProfile,
  isSwuUnauthorizedError: vi.fn(() => false),
  submitCheckIn: mocks.submitCheckIn,
}));

import { POST as createQr } from "@/app/api/auth/qr/route";
import { GET as pollStatus } from "@/app/api/auth/status/route";
import { DELETE as logout, GET as readSession } from "@/app/api/auth/session/route";
import { POST as refreshProfile } from "@/app/api/profile/route";
import { GET as readCheckIn, POST as submitCheckIn } from "@/app/api/check-in/route";

describe("服务关闭时的业务接口", () => {
  beforeEach(() => {
    process.env.SERVICE_ENABLED = "false";
    vi.clearAllMocks();
  });

  it.each([
    ["生成二维码", () => createQr(new Request("http://localhost/api/auth/qr", { method: "POST", headers: { Origin: "http://localhost" } }))],
    ["轮询登录", () => pollStatus()],
    ["读取会话", () => readSession()],
    ["刷新资料", () => refreshProfile(new Request("http://localhost/api/profile", { method: "POST", headers: { Origin: "http://localhost" } }))],
    ["查询签到", () => readCheckIn(new Request("http://localhost/api/check-in"))],
    ["提交签到", () => submitCheckIn(new Request("http://localhost/api/check-in", { method: "POST", headers: { Origin: "http://localhost" } }))],
  ])("%s 返回 503", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "服务暂未开放，请稍后再试" });
  });

  it("不调用会话、钉钉或校内业务函数", async () => {
    await createQr(new Request("http://localhost/api/auth/qr", { method: "POST" }));
    await pollStatus();
    await readSession();
    await readCheckIn(new Request("http://localhost/api/check-in"));
    expect(mocks.getLoginSession).not.toHaveBeenCalled();
    expect(mocks.startDingTalkLogin).not.toHaveBeenCalled();
    expect(mocks.pollDingTalkLogin).not.toHaveBeenCalled();
    expect(mocks.getCheckInStatus).not.toHaveBeenCalled();
  });

  it("退出登录仍清理旧会话", async () => {
    const response = await logout(new Request("http://localhost/api/auth/session", {
      method: "DELETE",
      headers: { Origin: "http://localhost" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.deleteLoginSession).toHaveBeenCalledWith("old-session");
    expect(mocks.cookieSet).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 验证路由仍执行业务逻辑，测试失败**

Run: `pnpm test src/app/api/service-disabled-routes.test.ts`

Expected: FAIL，至少一个接口不是 `503`，且业务 mock 被调用。

- [ ] **Step 3: 创建统一 HTTP 响应**

```ts
import "server-only";

import { NextResponse } from "next/server";

import { SERVICE_DISABLED_MESSAGE } from "@/lib/service-status";

export function serviceUnavailableResponse() {
  return NextResponse.json({ message: SERVICE_DISABLED_MESSAGE }, { status: 503 });
}
```

- [ ] **Step 4: 在每个业务处理器首行加入保护**

每个路由导入：

```ts
import { serviceUnavailableResponse } from "@/lib/service-http";
import { isServiceEnabled } from "@/lib/service-status";
```

在 `auth/qr POST`、`auth/status GET`、`auth/session GET`、`profile POST`、`check-in GET`、`check-in POST` 的函数体最前加入：

```ts
if (!isServiceEnabled()) return serviceUnavailableResponse();
```

`auth/session DELETE` 不加入该判断。

- [ ] **Step 5: 验证新旧路由测试通过**

Run: `pnpm test src/app/api/service-disabled-routes.test.ts src/app/api/auth/qr/route.test.ts src/app/api/check-in/route.test.ts`

Expected: PASS。若旧测试默认关闭，需要在相应 `beforeEach` 中设置 `process.env.SERVICE_ENABLED = "true"`，并在测试结束后恢复原值。

### Task 3: 页面关闭短路与维护界面

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.tsx`

- [ ] **Step 1: 编写维护状态失败测试**

扩展 `AppShellProps` 测试类型，并增加：

```ts
it("服务关闭时只渲染维护界面", () => {
  const element = AppShell({
    serviceEnabled: false,
    initialPayload: { stage: "unauthenticated" },
  }) as ReactElement;

  expect(element.type).toBeDefined();
  expect(element.props["data-service-state"]).toBe("disabled");
});
```

为了让该断言直接检查稳定边界，维护页根节点必须携带 `data-service-state="disabled"`。

- [ ] **Step 2: 验证属性尚不存在，测试失败**

Run: `pnpm test src/components/app-shell.test.tsx`

Expected: FAIL，提示 `serviceEnabled` 属性或关闭状态结构不匹配。

- [ ] **Step 3: 拆分关闭与开启组件，避免条件 Hook**

在 `app-shell.tsx` 中新增静态 `MaintenanceScreen`，根节点使用：

```tsx
function MaintenanceScreen() {
  return (
    <main data-service-state="disabled" className="min-h-dvh px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-3xl flex-col sm:min-h-[calc(100dvh-3rem)]">
        <SiteHeader status="服务关闭" />
        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <div data-visual="service-orbit" className="relative isolate grid size-44 place-items-center">
            <Sparkles className="size-14 text-primary" aria-hidden="true" />
          </div>
          <p className="mt-8 text-xs font-semibold tracking-[0.2em] text-primary uppercase">SWU Campus</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">服务暂未开放</h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">当前暂不提供二维码登录、住宿查询与临时签到，请稍后再访问。</p>
        </section>
      </div>
    </main>
  );
}
```

将现有带 Hook 的默认组件主体改名为 `EnabledAppShell`。默认导出组件只做稳定分流：

```tsx
interface AppShellProps {
  serviceEnabled: boolean;
  initialPayload: SessionPayload;
  initialCheckInStatus?: CheckInStatus;
  initialCheckInError?: string;
}

export default function AppShell({ serviceEnabled, ...props }: AppShellProps) {
  return serviceEnabled ? <EnabledAppShell {...props} /> : <MaintenanceScreen />;
}
```

- [ ] **Step 4: 在服务端页面最早短路**

在 `page.tsx` 导入 `isServiceEnabled`，并在 `cookies()` 前增加：

```tsx
if (!isServiceEnabled()) {
  return <AppShell serviceEnabled={false} initialPayload={{ stage: "unauthenticated" }} />;
}
```

开启路径传入 `serviceEnabled`：

```tsx
<AppShell
  serviceEnabled
  initialPayload={initialPayload}
  initialCheckInStatus={initialCheckInStatus}
  initialCheckInError={initialCheckInError}
/>
```

- [ ] **Step 5: 验证组件测试通过**

Run: `pnpm test src/components/app-shell.test.tsx`

Expected: PASS，原会话切换测试继续通过。

### Task 4: 星轨设计系统与复用头部

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: 添加结构性失败测试**

在 `app-shell.test.tsx` 增加对静态维护页的结构检查：

```ts
it("维护界面提供星轨视觉和明确状态", () => {
  const element = AppShell({
    serviceEnabled: false,
    initialPayload: { stage: "unauthenticated" },
  }) as ReactElement;
  const source = JSON.stringify(element.props);
  expect(source).toContain("disabled");
});
```

同时新建一个 CSS 回归测试并读取 `src/app/globals.css`，断言包含 `[data-visual="service-orbit"]`、`[data-visual="qr-orbit"]`、`prefers-reduced-motion`、`--shadow-neumorphic` 和 `--shadow-neumorphic-inset`。

- [ ] **Step 2: 运行测试并确认 CSS 标记缺失**

Run: `pnpm test src/components/app-shell.test.tsx src/app/globals.test.ts`

Expected: FAIL，缺少星轨选择器或新拟态变量。

- [ ] **Step 3: 替换全局视觉变量**

在 `:root` 使用参考项目同类暖色值：背景约 `oklch(0.985 0.012 85)`、正文约 `oklch(0.28 0.035 58)`、主色约 `oklch(0.55 0.09 55)`、卡片约 `oklch(0.97 0.018 84)`，并加入：

```css
--shadow-neumorphic: -4px -4px 10px rgb(255 255 255 / 85%), 4px 4px 10px rgb(153 124 83 / 22%);
--shadow-neumorphic-hover: -5px -5px 12px rgb(255 255 255 / 88%), 5px 5px 12px rgb(153 124 83 / 26%);
--shadow-neumorphic-inset: inset 3px 3px 7px rgb(153 124 83 / 24%), inset -3px -3px 7px rgb(255 255 255 / 82%);
```

`body` 使用顶部暖色径向光晕。为两个轨道选择器共用椭圆边框，为 `::after` 创建四角星芒，并在减弱动画媒体查询中关闭入场与脉冲动画。

- [ ] **Step 4: 新增按钮 `neumorphic` 变体**

在 `buttonVariants` 中加入：

```ts
neumorphic:
  "rounded-full border-transparent bg-secondary text-secondary-foreground shadow-[var(--shadow-neumorphic)] hover:-translate-y-0.5 hover:bg-secondary hover:shadow-[var(--shadow-neumorphic-hover)] active:translate-y-px active:shadow-[var(--shadow-neumorphic-inset)] motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0",
```

主要二维码、刷新和签到按钮使用该变体；危险或纯图标操作继续使用语义合适的变体。

- [ ] **Step 5: 抽取 `SiteHeader`**

在 `app-shell.tsx` 内创建复用头部组件，接受 `status` 与可选 `actions`，使用胶囊容器、半透明背景和新拟态阴影。维护页、登录页和 Dashboard 均复用它，避免三个页面复制品牌结构。

- [ ] **Step 6: 更新主题色并验证**

将 `layout.tsx` 的 `themeColor` 更新为与暖白背景匹配的 `#fff8ed`。

Run: `pnpm test src/components/app-shell.test.tsx src/app/globals.test.ts && pnpm typecheck`

Expected: PASS。

### Task 5: 登录页与 Dashboard 视觉重构

**Files:**
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: 建立视觉验收标记**

为登录页根节点添加 `data-screen="login"`，二维码稳定容器添加 `data-visual="qr-orbit"`；Dashboard 根节点添加 `data-screen="dashboard"`。维护页已有 `data-service-state="disabled"`。

- [ ] **Step 2: 重构登录页布局**

移除深色左右分栏与 `BrandPanelArt`，改为最大宽度约 `48rem` 的居中开放布局。保留所有状态条件与文案，将二维码方形内容放入星轨包装层；二维码本体保持白底、足够静区和稳定尺寸，轨道装饰不得覆盖二维码像素。

- [ ] **Step 3: 重构 Dashboard 布局**

使用悬浮胶囊头部；正文保持“标题与更新时间—状态操作—住宿档案—页脚”的顺序。主要状态区与住宿档案区在桌面双列、移动端单列，使用同级面板而非嵌套卡片。保留所有错误提示、loading、禁用条件和 `aria-live`。

- [ ] **Step 4: 检查客户端行为没有变化**

Run: `pnpm test src/components/app-shell.test.tsx src/lib/client-api.test.ts`

Expected: PASS，重新登录后不复用旧签到状态，退出错误仍可显示。

### Task 6: 配置文档

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: 更新环境变量示例**

在 `.env.example` 顶部增加：

```env
# 只有 true 时开放二维码登录、住宿查询和临时签到；其他值均视为关闭。
SERVICE_ENABLED=false
```

- [ ] **Step 2: 更新运行说明**

README 的示例配置加入 `SERVICE_ENABLED=false`，并明确：首次运行默认关闭；需要开放时设置为 `true` 并重启进程；关闭时业务 API 返回 `503`，退出登录仍可用于清理旧会话。

- [ ] **Step 3: 检查文档与真实实现一致**

Run: `rg -n "SERVICE_ENABLED|503|服务暂未开放" .env.example README.md src/lib src/app`

Expected: 环境变量名、默认值和关闭说明一致，不出现旧变量名。

### Task 7: 完整验证与视觉验收

**Files:**
- Verify only; no new production files unless修复验证中发现的问题。

- [ ] **Step 1: 运行代码质量检查**

Run: `pnpm lint`

Expected: exit code 0。

Run: `pnpm typecheck`

Expected: exit code 0。

Run: `pnpm test`

Expected: 全部测试通过。

Run: `pnpm build`

Expected: Next.js production build 成功。

- [ ] **Step 2: 验证关闭状态**

使用 `SERVICE_ENABLED=false` 启动应用，检查首页只显示维护状态；通过浏览器或 HTTP 请求确认六个业务入口返回 `503`，退出登录返回成功。确认终端没有钉钉或校内上游请求。

- [ ] **Step 3: 验证开启状态**

使用 `SERVICE_ENABLED=true` 启动应用，检查空闲登录页不会自动生成二维码；点击“生成登录二维码”后进入生成或上游错误状态，页面布局不跳动。若无法访问真实上游，记录该外部限制，不伪造成功结论。

- [ ] **Step 4: 桌面与移动端视觉验收**

桌面使用约 `1440×900`，移动端使用约 `390×844`。分别截图维护页、登录页和可获得的业务状态，与 `C:\Users\Admin\Documents\Repositories\portfolio` 的暖色变量、胶囊头部、新拟态阴影、椭圆轨道和星芒进行对照。至少检查：首屏层级、字体、暖色调、轨道不遮挡内容、二维码静区、按钮反馈、移动端无横向溢出、减弱动画。

- [ ] **Step 5: 最终工作区检查**

Run: `git status --short && git diff --check`

Expected: 只有本任务相关文件发生变化，`git diff --check` 无空白错误；不包含 `.env`、`.data`、`.next` 或其他敏感/生成文件。
