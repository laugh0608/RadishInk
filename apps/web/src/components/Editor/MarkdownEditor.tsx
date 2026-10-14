import { useEffect, useRef, useState } from "react";
import { EditorView, minimalSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import {
  editorBaseThemeDark,
  editorBaseThemeLight,
  wechatMarkdownHighlighting,
  wechatMarkdownHighlightingDark,
} from "./markdownTheme";
import { markdownBlockDecorations } from "./editorMarkdownDecorations";
import { mathExtension } from "./markdownMath";
import { underlineExtension } from "./markdownUnderline";
import { useUITheme } from "../../hooks/useUITheme";
import { useEditorStore } from "../../store/editorStore";
import { countWords, countLines } from "../../utils/wordCount";
import { Toolbar } from "./Toolbar";
import { SearchPanel } from "./SearchPanel";
import { SaveIndicator } from "./SaveIndicator";
import toast from "react-hot-toast";
import "./MarkdownEditor.css";
import { customKeymap } from "./editorShortcuts";
import { paragraphSelectionStyle } from "./mouseSelectionStyle";
import {
  shouldSnapToScrollEdge,
  subscribeScrollIntent,
  type ScrollSyncAdapter,
} from "../Workspace/editorPreviewScrollSync";

interface MarkdownEditorProps {
  onScrollSyncReady?: (adapter: ScrollSyncAdapter | null) => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function MarkdownEditor({ onScrollSyncReady }: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { markdown: content, setMarkdown } = useEditorStore();
  const uiTheme = useUITheme((state) => state.theme);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const currentContent = viewRef.current
      ? viewRef.current.state.doc.toString()
      : content;

    const startState = EditorState.create({
      doc: currentContent,
      extensions: [
        minimalSetup,
        customKeymap,
        markdown({
          base: markdownLanguage,
          // 围栏代码块按语言懒加载高亮，Vite 会把各语言拆成独立 chunk
          codeLanguages: languages,
          extensions: [underlineExtension, mathExtension],
        }),
        uiTheme === "dark"
          ? [wechatMarkdownHighlightingDark, editorBaseThemeDark]
          : [wechatMarkdownHighlighting, editorBaseThemeLight],
        markdownBlockDecorations,
        EditorView.lineWrapping,
        paragraphSelectionStyle,
        EditorView.domEventHandlers({
          paste: (event) => {
            if (
              Array.from(event.clipboardData?.items ?? []).some((item) =>
                item.type.startsWith("image/"),
              )
            ) {
              event.preventDefault();
              toast.error("文章图片保存功能尚未提供；可以插入已有图片链接。");
              return true;
            }
            return false;
          },
          drop: (event) => {
            if (
              Array.from(event.dataTransfer?.files ?? []).some((file) =>
                file.type.startsWith("image/"),
              )
            ) {
              event.preventDefault();
              toast.error("文章图片保存功能尚未提供；可以插入已有图片链接。");
              return true;
            }
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            setMarkdown(newContent);
          }
        }),
        EditorView.theme({
          "&": {
            height: "100%",
          },
          ".cm-scroller": {
            fontFamily: "var(--font-mono)",
          },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    });

    const scrollDOM = view.scrollDOM;
    let scrollSubscriber: () => void = () => undefined;
    const getPosition = () => {
      const max = scrollDOM.scrollHeight - scrollDOM.clientHeight;
      const ratio = max > 0 ? scrollDOM.scrollTop / max : 0;
      const block = view.lineBlockAtHeight(scrollDOM.scrollTop);
      const line = view.state.doc.lineAt(block.from).number - 1;
      const progress =
        block.height > 0
          ? clamp((scrollDOM.scrollTop - block.top) / block.height, 0, 1)
          : 0;
      return { sourceLine: line + progress, ratio };
    };

    const scrollToPosition: ScrollSyncAdapter["scrollToPosition"] = (
      position,
    ) => {
      const max = scrollDOM.scrollHeight - scrollDOM.clientHeight;
      if (max <= 0) return;
      const { sourceLine } = position;
      if (sourceLine === null || shouldSnapToScrollEdge(position)) {
        scrollDOM.scrollTo({ top: clamp(position.ratio, 0, 1) * max });
        return;
      }

      const targetSourceLine = clamp(
        sourceLine,
        0,
        Math.max(0, view.state.doc.lines - 1),
      );
      const lineNumber = Math.floor(targetSourceLine) + 1;
      const block = view.lineBlockAt(view.state.doc.line(lineNumber).from);
      const target = block.top + (targetSourceLine % 1) * block.height;
      scrollDOM.scrollTo({ top: clamp(target, 0, max) });
    };

    const handleEditorScroll = () => scrollSubscriber();
    scrollDOM.addEventListener("scroll", handleEditorScroll, { passive: true });
    onScrollSyncReady?.({
      getPosition,
      scrollToPosition,
      subscribeScroll: (listener) => {
        scrollSubscriber = listener;
        return () => {
          if (scrollSubscriber === listener) scrollSubscriber = () => undefined;
        };
      },
      subscribeUserIntent: (listener) =>
        subscribeScrollIntent(scrollDOM, listener),
    });

    viewRef.current = view;

    return () => {
      scrollDOM.removeEventListener("scroll", handleEditorScroll);
      onScrollSyncReady?.(null);
      view.destroy();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMarkdown, uiTheme, onScrollSyncReady]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc === content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, [content]);

  const wordCount = countWords(content);
  const lineCount = countLines(content);

  const handleInsert = (
    prefix: string,
    suffix: string,
    placeholder: string,
  ) => {
    const view = viewRef.current;
    if (!view) return;

    const selection = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(
      selection.from,
      selection.to,
    );
    const textToInsert = selectedText || placeholder;
    const fullText = prefix + textToInsert + suffix;

    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: fullText,
      },
      selection: {
        anchor: selection.from + prefix.length,
        head: selection.from + prefix.length + textToInsert.length,
      },
    });

    view.focus();
  };

  return (
    <div className="markdown-editor">
      <div className="editor-header">
        <span className="editor-title">Markdown 编辑器</span>
      </div>
      <Toolbar onInsert={handleInsert} />
      {showSearch && viewRef.current && (
        <SearchPanel
          view={viewRef.current}
          onClose={() => setShowSearch(false)}
        />
      )}
      <div className="editor-body-wrapper">
        <div ref={editorRef} className="editor-container" />
      </div>
      <div className="editor-footer">
        <div className="editor-stats">
          <span className="editor-stat">行数: {lineCount}</span>
          <span className="editor-stat">字数: {wordCount}</span>
        </div>
        <SaveIndicator />
      </div>
    </div>
  );
}
