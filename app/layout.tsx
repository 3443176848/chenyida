import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "晨亿达 ERP",
  description: "晨亿达多用户在线 ERP，覆盖主数据、采购、库存、生产、销售、财务和品质协同。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
