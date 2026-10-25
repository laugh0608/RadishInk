import { create } from "zustand";

interface DirectoryStorageState {
  pendingOperations: number;
  issue: { workspace: unknown; path: string; message: string } | null;
}
export const useDirectoryStorageState = create<DirectoryStorageState>(() => ({
  pendingOperations: 0,
  issue: null,
}));
export function reportDirectoryIssue(
  workspace: unknown,
  path: string,
  error: unknown,
) {
  useDirectoryStorageState.setState({
    issue: {
      workspace,
      path,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}
