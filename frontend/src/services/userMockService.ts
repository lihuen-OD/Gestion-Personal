import type { User } from "../types";
import { readStore, writeStore } from "./storage";

export const userMockService = {
  getAll: () => readStore<User>("users"),
  getById: (id: string) => readStore<User>("users").find((user) => user.id === id),
  create: (user: User) => { writeStore("users", [...readStore<User>("users"), user]); return user; },
  update: (user: User) => {
    const users = readStore<User>("users");
    writeStore("users", users.map((item) => item.id === user.id ? user : item));
    return user;
  },
  resetPassword: (id: string, password: string) => {
    const users = readStore<User>("users");
    const updated = users.map((item) => item.id === id ? { ...item, password } : item);
    writeStore("users", updated);
    return updated.find((item) => item.id === id);
  },
};
