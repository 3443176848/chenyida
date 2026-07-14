import type { Metadata } from "next";
import { MaterialShell } from "./_components/material-shell";

export const metadata: Metadata = {
  title: "物料主数据 - 晨亿达 ERP",
  description: "晨亿达 ERP 物料主数据只读查询、详情、版本和变更日志。",
};

export default function MaterialsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <MaterialShell>{children}</MaterialShell>;
}
