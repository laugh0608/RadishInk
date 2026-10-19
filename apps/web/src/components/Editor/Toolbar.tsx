import { useLayoutEffect, useState } from "react";
import {
  Heading,
  List,
  Workflow,
  ListEnd,
  WrapText,
  MoreHorizontal,
  HelpCircle,
  Image,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  blockTools,
  headingOptions,
  listOptions,
  mermaidMoreTemplates,
  mermaidPrimaryTemplates,
  textFormatTools,
  type ToolbarInsertTool,
} from "./toolbarConfigs";
import {
  getPublishingPreference,
  setPublishingPreference,
} from "../../store/publishingPreferences";
import { ActionMenu, type MenuAction } from "../common/ActionMenu";
import { SyntaxHelpPanel } from "./SyntaxHelpPopover";
import { useToolbarOverflow } from "./useToolbarOverflow";
import "./Toolbar.css";

interface ToolbarProps {
  onInsert: (prefix: string, suffix: string, placeholder: string) => void;
  onSelectImages?: () => void;
}
export function Toolbar({ onInsert, onSelectImages }: ToolbarProps) {
  const [linkToFootnote, setLinkToFootnote] = useState(() =>
    getPublishingPreference("linkToFootnote"),
  );
  const [tableWrap, setTableWrap] = useState(() =>
    getPublishingPreference("tableWrap"),
  );
  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null);
  const insert = (tool: ToolbarInsertTool): MenuAction => ({
    id: tool.label,
    label: tool.label,
    icon: <tool.icon size={16} />,
    onSelect: () => onInsert(tool.prefix, tool.suffix, tool.placeholder),
  });
  const commands: (MenuAction & { priority: number })[] = [
    ...(onSelectImages
      ? [
          {
            id: "article-images",
            label: "选择图片",
            icon: <Image size={16} />,
            onSelect: onSelectImages,
            priority: 5,
          },
        ]
      : []),
    ...textFormatTools.map((tool, index) => ({
      ...insert(tool),
      priority: index < 2 ? index : index + 8,
    })),
    {
      id: "heading",
      label: "标题",
      icon: <Heading size={16} />,
      children: headingOptions.map(insert),
      priority: 2,
    },
    {
      id: "list",
      label: "列表",
      icon: <List size={16} />,
      children: listOptions.map(insert),
      priority: 3,
    },
    ...blockTools.map((tool, index) => ({
      ...insert(tool),
      priority: [6, 7, 4, 12][index],
    })),
    {
      id: "image-link",
      label: "图片链接",
      icon: <Image size={16} />,
      onSelect: () => onInsert("![", "](url)", "图片描述"),
      priority: 5,
    },
    {
      id: "mermaid",
      label: "插入图表",
      icon: <Workflow size={16} />,
      priority: 13,
      children: [...mermaidPrimaryTemplates, ...mermaidMoreTemplates].map(
        (template) => ({
          id: template.label,
          label: template.label,
          icon: <template.icon size={16} />,
          onSelect: () => onInsert("```mermaid\n", "\n```", template.code),
        }),
      ),
    },
    {
      id: "footnote",
      label: `外链转脚注：${linkToFootnote ? "开启" : "关闭"}`,
      icon: <ListEnd size={16} />,
      checked: linkToFootnote,
      priority: 14,
      onSelect: () => {
        setPublishingPreference("linkToFootnote", !linkToFootnote);
        setLinkToFootnote(!linkToFootnote);
        toast.success(
          linkToFootnote ? "已关闭：外链转脚注" : "已开启：外链转脚注",
        );
      },
    },
    {
      id: "table",
      label: `表格自动换行：${tableWrap ? "开启" : "关闭"}`,
      icon: <WrapText size={16} />,
      checked: tableWrap,
      priority: 15,
      onSelect: () => {
        setPublishingPreference("tableWrap", !tableWrap);
        setTableWrap(!tableWrap);
        toast.success(
          tableWrap ? "已关闭：表格自动换行" : "已开启：表格自动换行",
        );
      },
    },
    {
      id: "help",
      label: "语法帮助",
      icon: <HelpCircle size={16} />,
      priority: 16,
      onSelect: () => setHelpAnchor(document.activeElement as HTMLElement),
    },
  ];
  const { toolbar, measure, visible } = useToolbarOverflow(
    commands.map((command) => command.priority),
  );
  useLayoutEffect(() => {
    if (helpAnchor && !helpAnchor.isConnected) {
      setHelpAnchor(
        toolbar.current?.querySelector<HTMLElement>(
          '[aria-label="语法帮助"]',
        ) ??
          toolbar.current?.querySelector<HTMLElement>(
            '[aria-label="更多编辑工具"]',
          ) ??
          null,
      );
    }
  }, [visible, helpAnchor, toolbar]);
  const overflow = commands.filter((_, index) => !visible.includes(index));
  return (
    <div
      ref={toolbar}
      className="md-toolbar"
      role="toolbar"
      aria-label="编辑工具"
    >
      {overflow.length > 0 && (
        <ActionMenu
          label="更多编辑工具"
          icon={<MoreHorizontal size={16} />}
          actions={overflow}
        />
      )}
      {commands.map(
        (command, index) =>
          visible.includes(index) && (
            <div key={command.id} data-toolbar-index={index}>
              {command.children ? (
                <ActionMenu
                  label={command.label}
                  icon={command.icon}
                  actions={command.children}
                />
              ) : (
                <button
                  type="button"
                  className={`md-toolbar-btn ${command.checked ? "active" : ""}`}
                  aria-label={command.label}
                  aria-pressed={command.checked}
                  data-tooltip={command.label}
                  onClick={(event) => {
                    event.currentTarget.focus();
                    command.onSelect?.();
                  }}
                >
                  {command.icon}
                </button>
              )}
            </div>
          ),
      )}
      <div ref={measure} className="toolbar-measure" aria-hidden="true">
        {commands.map((command) => (
          <span key={command.id} className="md-toolbar-btn">
            {command.icon}
          </span>
        ))}
        <span className="md-toolbar-btn">
          <MoreHorizontal size={16} />
        </span>
      </div>
      {helpAnchor && (
        <SyntaxHelpPanel
          anchor={helpAnchor}
          onClose={() => setHelpAnchor(null)}
        />
      )}
    </div>
  );
}
