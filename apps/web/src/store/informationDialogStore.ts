import { create } from "zustand";

export type InformationPage = "about" | "help";
export type HelpSection = "syntax";

interface InformationDialogState {
  page: InformationPage | null;
  section?: HelpSection;
  open: (page: InformationPage, section?: HelpSection) => void;
  close: () => void;
}

// Information panels share one transient state, independent of article storage.
export const useInformationDialogStore = create<InformationDialogState>(
  (set) => ({
    page: null,
    open: (page, section) =>
      set({ page, section: page === "help" ? section : undefined }),
    close: () => set({ page: null, section: undefined }),
  }),
);
