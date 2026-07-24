import { randomUUID } from "node:crypto";

export interface Clock { now(): Date }
export interface IdGenerator { uuid(): string }

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { uuid: () => randomUUID() };
