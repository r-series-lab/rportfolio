import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import type { ReactNode } from "react";

type ProgressiveDisclosureProps = {
  badge?: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  label: string;
};

export function ProgressiveDisclosure({
  badge,
  children,
  className = "",
  defaultOpen = false,
  label,
}: ProgressiveDisclosureProps) {
  return (
    <details className={`progressive-disclosure ${className}`.trim()} open={defaultOpen || undefined}>
      <summary>
        <span>{label}</span>
        {badge ? <em>{badge}</em> : null}
        <KeyboardArrowDownRoundedIcon aria-hidden="true" fontSize="inherit" />
      </summary>
      <div className="progressive-disclosure-content">{children}</div>
    </details>
  );
}
