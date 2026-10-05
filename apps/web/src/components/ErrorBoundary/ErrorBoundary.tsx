import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorBoundary.css";

interface Props {
  children?: ReactNode;
}

type CopyStatus = "idle" | "copied" | "failed" | "unavailable";

interface State {
  hasError: boolean;
  error?: Error;
  copyStatus: CopyStatus;
}

const COPY_LABEL: Record<CopyStatus, string> = {
  idle: "复制错误信息",
  copied: "已复制",
  failed: "复制失败，请手动选中错误信息",
  unavailable: "剪贴板不可用，请手动选中错误信息",
};

const ISSUE_URL = "https://github.com/laugh0608/RadishInk/issues/new";

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    copyStatus: "idle",
  };

  private resetCopyTimer: number | undefined;

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public componentWillUnmount() {
    window.clearTimeout(this.resetCopyTimer);
  }

  private flashCopyStatus(status: CopyStatus) {
    window.clearTimeout(this.resetCopyTimer);
    this.setState({ copyStatus: status });
    this.resetCopyTimer = window.setTimeout(
      () => this.setState({ copyStatus: "idle" }),
      2000,
    );
  }

  private handleCopy = async () => {
    const detail = this.errorDetail();
    if (!detail || !navigator.clipboard?.writeText) {
      this.flashCopyStatus("unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(detail);
      this.flashCopyStatus("copied");
    } catch (error) {
      console.error("Failed to copy error:", error);
      this.flashCopyStatus("failed");
    }
  };

  private errorDetail(): string {
    const { error } = this.state;
    if (!error) return "";
    return error.stack || error.message;
  }

  private issueUrl(): string {
    const { error } = this.state;
    const title = `[Crash] ${error?.message || "Unknown Error"}`;
    const body = `**Error Message**:\n${error?.message ?? ""}\n\n**Stack Trace**:\n\`\`\`\n${error?.stack ?? ""}\n\`\`\``;
    return `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }

  public render() {
    if (!this.state.hasError) return this.props.children;

    const detail = this.errorDetail();

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h1>RadishInk 遇到错误</h1>
          <p className="error-boundary-desc">
            抱歉，编辑器运行过程中发生意外异常。
            <br />
            您可以复制下方错误信息进行反馈，或尝试刷新页面。
          </p>

          {detail && <pre className="error-boundary-stack">{detail}</pre>}

          <div className="error-boundary-actions">
            <button
              className="error-boundary-btn primary"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
            <button className="error-boundary-btn" onClick={this.handleCopy}>
              {COPY_LABEL[this.state.copyStatus]}
            </button>
            <a
              className="error-boundary-btn"
              href={this.issueUrl()}
              target="_blank"
              rel="noopener noreferrer"
            >
              去 GitHub 反馈
            </a>
          </div>
        </div>
      </div>
    );
  }
}
