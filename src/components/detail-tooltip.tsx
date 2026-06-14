import { Tooltip, type TooltipProps } from "@mui/material";
import type { ReactElement, ReactNode } from "react";

type DetailTooltipProps = {
  children: ReactElement;
  placement?: TooltipProps["placement"];
  title?: ReactNode;
};

export function DetailTooltip({ children, placement = "top", title }: DetailTooltipProps) {
  if (!title) {
    return children;
  }

  return (
    <Tooltip title={title} placement={placement} enterTouchDelay={0} leaveTouchDelay={2600}>
      {children}
    </Tooltip>
  );
}
