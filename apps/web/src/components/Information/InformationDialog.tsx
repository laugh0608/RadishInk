import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useInformationDialogStore } from "../../store/informationDialogStore";
import { Modal } from "../common/Modal";
import { AboutContent } from "./AboutContent";
import { HelpContent } from "./HelpContent";
import "./InformationDialog.css";

export function InformationDialog() {
  const page = useInformationDialogStore((state) => state.page);
  const section = useInformationDialogStore((state) => state.section);
  const open = useInformationDialogStore((state) => state.open);
  const close = useInformationDialogStore((state) => state.close);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const openFromLocation = () => {
      const url = new URL(window.location.href);
      if (
        ![
          "#radishink/about",
          "#radishink/help",
          "#radishink/help/syntax",
        ].includes(url.hash)
      )
        return;
      open(
        url.hash === "#radishink/about" ? "about" : "help",
        url.hash === "#radishink/help/syntax" ? "syntax" : undefined,
      );
      // Consume only our entry fragment, preserving unrelated query parameters.
      url.hash = "";
      window.history.replaceState(window.history.state, "", url);
    };
    openFromLocation();
    window.addEventListener("hashchange", openFromLocation);
    return () => window.removeEventListener("hashchange", openFromLocation);
  }, [open]);

  useEffect(() => {
    const content = contentRef.current;
    if (!page || !content) return;
    const heading = content.querySelector<HTMLElement>(
      section === "syntax"
        ? "#information-syntax"
        : "[data-information-heading]",
    );
    content.scrollTop = 0;
    if (heading) {
      // This runs after Modal's initial focus and also handles in-dialog navigation.
      heading.focus({ preventScroll: true });
      if (section === "syntax") heading.scrollIntoView({ block: "start" });
    }
  }, [page, section]);

  return createPortal(
    <Modal
      open={page !== null}
      onClose={close}
      title={page === "about" ? "关于与许可" : "使用帮助"}
      className="information-dialog"
      bodyClassName="information-dialog-body"
    >
      <nav className="information-navigation" aria-label="信息导航">
        <button
          type="button"
          aria-pressed={page === "about"}
          onClick={() => open("about")}
        >
          关于与许可
        </button>
        <button
          type="button"
          aria-pressed={page === "help"}
          onClick={() => open("help")}
        >
          使用帮助
        </button>
      </nav>
      <div className="information-content" ref={contentRef}>
        {page === "about" ? <AboutContent /> : <HelpContent />}
      </div>
    </Modal>,
    document.body,
  );
}
