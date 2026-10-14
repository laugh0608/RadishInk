import { create } from "zustand";

/** 与文章列表分离，初始化失败不会被解释成一个空工作区。 */
export const useHistoryStorageState = create<{
  status: "checking" | "upgrade-required" | "ready" | "error";
  message: string;
}>(() => ({ status: "checking", message: "" }));
