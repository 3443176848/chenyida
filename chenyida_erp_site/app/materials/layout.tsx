import type { Metadata } from "next";
import { MaterialShell } from "./_components/material-shell";

export const metadata: Metadata = {
  title: "物料主数据 - 晨亿达 ERP",
  description: "晨亿达 ERP 物料主数据查询、详情、草稿创建编辑、提交审核与受控审核工作台。",
};

export default function MaterialsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <MaterialShell>{children}</MaterialShell>;
}
