import DataUsageRoundedIcon from "@mui/icons-material/DataUsageRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import {
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Tooltip,
} from "@mui/material";
import type {
  ProfileSummary,
} from "../lib/types";
import type { RPortfolioStyleMode } from "../theme/r-theme";
import { MarketDatePicker } from "./market-date-picker";

type AppTopbarProps = {
  asOf: string;
  loading: boolean;
  profile: string;
  profiles: ProfileSummary[];
  onAsOfChange: (value: string) => void;
  onProfileChange: (value: string) => void;
  onRefresh: () => void;
};

type AppTitlebarActionsProps = {
  onOpenProfileConfig: () => void;
  onToggleStyleMode: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  sourceDetail: string;
  sourceLabel: string;
  sourceQuality: "pass" | "warn" | "block";
  styleMode: RPortfolioStyleMode;
};

export function AppTopbar({
  asOf,
  loading,
  profile,
  profiles,
  onAsOfChange,
  onProfileChange,
  onRefresh,
}: AppTopbarProps) {
  const profileOptions = profiles.length ? profiles : [{ key: profile, name: profile, market: "", description: "", builtin: false }];

  return (
    <div className="topbar-layout">
      <div className="topbar-controls">
        <FormControl size="small" className="profile-select topbar-field">
          <Select
            value={profile}
            onChange={(event) => onProfileChange(event.target.value)}
            inputProps={{ "aria-label": "Profile" }}
            renderValue={(value) => (
              <span
                className="select-value-with-icon profile-select-value"
                title={profileNameFor(profileOptions, String(value))}
              >
                <QueryStatsRoundedIcon fontSize="inherit" />
                <span>{profileNameFor(profileOptions, String(value))}</span>
              </span>
            )}
          >
            {profileOptions.map((item) => (
              <MenuItem key={item.key} value={item.key} className="profile-menu-option">
                <span>{item.name}</span>
                <em>{item.market ? item.market.toUpperCase() : item.key}</em>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <MarketDatePicker value={asOf} onChange={onAsOfChange} />
        <Tooltip title="刷新评分">
          <span>
            <IconButton
              className="topbar-refresh-button"
              aria-label="刷新评分"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

export function AppTitlebarActions({
  onOpenProfileConfig,
  onToggleStyleMode,
  onToggleSidebar,
  sidebarCollapsed,
  sourceDetail,
  sourceLabel,
  sourceQuality,
  styleMode,
}: AppTitlebarActionsProps) {
  return (
    <>
      <div className="window-leading-actions" aria-label="左侧窗口工具">
        <Tooltip title={sidebarCollapsed ? "展开左侧菜单" : "收起左侧菜单"}>
          <span>
            <IconButton
              className={`titlebar-icon-button rail-collapse-titlebar-button left-rail-toggle-button ${sidebarCollapsed ? "is-collapsed" : ""}`}
              aria-label={sidebarCollapsed ? "展开左侧菜单" : "收起左侧菜单"}
              aria-pressed={sidebarCollapsed}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleSidebar();
              }}
            >
              <RailCollapseIcon direction="left" />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      <div className="window-titlebar-actions" aria-label="窗口工具">
        <Tooltip title={`当前数据源：${sourceLabel}。${sourceDetail} 点击进入全局设置`}>
          <button type="button" className={`global-source-status is-${sourceQuality}`} onClick={onOpenProfileConfig}>
            <DataUsageRoundedIcon fontSize="inherit" />
            <span>{sourceLabel}</span>
            <i aria-label={sourceQuality === "pass" ? "数据可信" : sourceQuality === "warn" ? "数据待确认" : "数据阻断"} />
          </button>
        </Tooltip>
        <Tooltip title={styleMode === "dark" ? "切换到亮色" : "切换到暗色"}>
          <span>
            <IconButton
              className="titlebar-icon-button theme-mode-button"
              aria-label={styleMode === "dark" ? "切换到亮色" : "切换到暗色"}
              onClick={onToggleStyleMode}
            >
              {styleMode === "dark" ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Profile 配置">
          <span>
            <IconButton
              className="titlebar-icon-button"
              aria-label="打开 Profile 配置"
              onClick={onOpenProfileConfig}
            >
              <SettingsRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </>
  );
}

function RailCollapseIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <span className={`rail-collapse-icon is-${direction}`} aria-hidden="true">
      <span />
    </span>
  );
}

function profileNameFor(profiles: Array<{ key: string; name: string }>, key: string) {
  return profiles.find((item) => item.key === key)?.name ?? key;
}
