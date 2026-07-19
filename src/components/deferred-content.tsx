import { RotateCcw } from "lucide-react";
import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button";

type DeferredContentProps = {
  children: ReactNode;
  label: string;
  resetKey: string;
  variant?: "workspace" | "overlay";
};

type DeferredErrorBoundaryProps = DeferredContentProps;

type DeferredErrorBoundaryState = {
  error: Error | null;
};

class DeferredErrorBoundary extends Component<DeferredErrorBoundaryProps, DeferredErrorBoundaryState> {
  state: DeferredErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DeferredErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Deferred workspace failed to render", error, info.componentStack);
  }

  componentDidUpdate(previousProps: DeferredErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return <DeferredState error label={this.props.label} variant={this.props.variant} />;
    }

    return this.props.children;
  }
}

export function DeferredContent({ children, label, resetKey, variant = "workspace" }: DeferredContentProps) {
  return (
    <DeferredErrorBoundary label={label} resetKey={resetKey} variant={variant}>
      <Suspense fallback={<DeferredState label={label} variant={variant} />}>
        {children}
      </Suspense>
    </DeferredErrorBoundary>
  );
}

function DeferredState({
  error = false,
  label,
  variant = "workspace",
}: {
  error?: boolean;
  label: string;
  variant?: "workspace" | "overlay";
}) {
  return (
    <section
      className={`deferred-content-state is-${variant} ${error ? "is-error" : "is-loading"}`}
      role={error ? "alert" : "status"}
      aria-busy={!error}
      aria-live="polite"
    >
      <div className="deferred-state-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div>
        <strong>{error ? `${label}未能打开` : `正在打开${label}…`}</strong>
        <span>{error ? "工作区代码加载失败，请重新加载应用后再试。" : "正在恢复上次视图和本地数据。"}</span>
      </div>
      {error ? (
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          <RotateCcw aria-hidden="true" />
          重新加载应用
        </Button>
      ) : null}
    </section>
  );
}
