import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SWU钉钉扫码打卡",
  description: "西南大学住宿信息查询与临时签到",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fff8ed",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
