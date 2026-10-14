import { create } from "zustand";

interface DirectoryStorageState {
  issue: { workspace: unknown; path: string; message: string } | null;
}
export const useDirectoryStorageState = create<DirectoryStorageState>(() => ({
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
