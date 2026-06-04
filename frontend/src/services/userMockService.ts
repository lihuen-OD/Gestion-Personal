import type { User } from "../types";
import { readStore, writeStore } from "./storage";

export const userMockService = {
  getAll: () => readStore<User>("users"),
  create: (user: User) => { writeStore("users", [...readStore<User>("users"), user]); return user; },
};
