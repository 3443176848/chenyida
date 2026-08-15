import {hasPermission} from "../identity-selfhost/permissions.ts";
import {DashboardError} from "./errors.ts";
import type {DashboardActor,DashboardDomain,DashboardModule} from "./types.ts";

export const DASHBOARD_ROLE_DOMAINS:Readonly<Record<string,readonly DashboardDomain[]>>={
  admin:["material","partners","engineering","inventory","procurement","production","sales","quality","finance","operations"],manager:["material","partners","engineering","inventory","procurement","production","sales","quality","finance","operations"],operations:["material","partners","engineering","inventory","procurement","production","sales","quality","finance","operations"],
  purchase:["material","partners","inventory","procurement","quality"],engineering:["material","partners","engineering","inventory"],planning:["material","partners","engineering","inventory"],production:["material","engineering","inventory","procurement","production","quality"],warehouse:["material","inventory","procurement","production","sales","quality"],quality:["inventory","procurement","production","sales","quality"],sales:["partners","engineering","inventory","sales","quality"],finance:["partners","procurement","sales","finance"],
};
export function requireDashboard(actor:DashboardActor){if(!hasPermission(actor,"dashboard.read"))throw new DashboardError("PERMISSION_DENIED","没有权限读取经营看板",403);}
export function requireManagement(actor:DashboardActor){requireDashboard(actor);if(!hasPermission(actor,"dashboard.management.read"))throw new DashboardError("PERMISSION_DENIED","没有权限读取管理看板",403);}
export function canReadDomain(actor:DashboardActor,domain:DashboardDomain){return(DASHBOARD_ROLE_DOMAINS[actor.role]??[]).includes(domain);}
export function permittedModules(actor:DashboardActor,modules:DashboardModule[]){return modules.filter(item=>hasPermission(actor,item.permission)&&!item.excludedRoles?.includes(actor.role));}
