import DataUsageRoundedIcon from "@mui/icons-material/DataUsageRounded";
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
  DataSource,
  DataSourceSummary,
  ProfileSummary,
} from "../lib/types";
import { MarketDatePicker } from "./market-date-picker";

type AppTopbarProps = {
  asOf: string;
  loading: boolean;
  profile: string;
  profiles: ProfileSummary[];
  dataSources: DataSourceSummary[];
  source: DataSource;
  onAsOfChange: (value: string) => void;
  onProfileChange: (value: string) => void;
  onSourceChange: (value: DataSource) => void;
  onRefresh: () => void;
};

type AppTitlebarActionsProps = {
  onOpenProfileConfig: () => void;
  onToggleSidebar: () => void;
  onToggleRightRail: () => void;
  sidebarCollapsed: boolean;
  rightRailCollapsed: boolean;
  rightRailLabel: string;
};

export function AppTopbar({
  asOf,
  loading,
  profile,
  profiles,
  dataSources,
  source,
  onAsOfChange,
  onProfileChange,
  onSourceChange,
  onRefresh,
}: AppTopbarProps) {
  const profileOptions = profiles.length ? profiles : [{ key: profile, name: profile, market: "", description: "", builtin: false }];
  const sourceOptions = dataSources.length
    ? dataSources
    : [
        { key: "auto", name: "自动" },
        { key: "yahoo", name: "Yahoo" },
        { key: "csv", name: "CSV" },
        { key: "sample", name: "示例" },
      ];

  return (
    <div className="topbar-layout">
      <div className="topbar-controls">
        <FormControl size="small" className="profile-select topbar-field">
          <Select
            value={profile}
            onChange={(event) => onProfileChange(event.target.value)}
            inputProps={{ "aria-label": "Profile" }}
            renderValue={(value) => (
              <span className="select-value-with-icon profile-select-value">
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
        <FormControl size="small" className="source-select topbar-field">
          <Select
            value={source}
            onChange={(event) => onSourceChange(event.target.value as DataSource)}
            inputProps={{ "aria-label": "数据源" }}
            renderValue={(value) => (
              <span className="select-value-with-icon">
                <DataUsageRoundedIcon fontSize="inherit" />
                {sourceNameFor(sourceOptions, value as DataSource)}
              </span>
            )}
          >
            {sourceOptions.map((item) => (
              <MenuItem key={item.key} value={item.key}>
                {item.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
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
  onToggleSidebar,
  onToggleRightRail,
  sidebarCollapsed,
  rightRailCollapsed,
  rightRailLabel,
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
              onClick={onToggleSidebar}
            >
              <RailCollapseIcon direction="left" />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      <div className="window-titlebar-actions" aria-label="窗口工具">
        <Tooltip title={`${rightRailCollapsed ? "展开" : "收起"}${rightRailLabel}`}>
          <span>
            <IconButton
              className={`titlebar-icon-button rail-collapse-titlebar-button right-rail-toggle-button ${rightRailCollapsed ? "is-collapsed" : ""}`}
              aria-label={`${rightRailCollapsed ? "展开" : "收起"}${rightRailLabel}`}
              aria-pressed={rightRailCollapsed}
              onClick={onToggleRightRail}
            >
              <RailCollapseIcon direction="right" />
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

function sourceNameFor(sources: Array<{ key: DataSource | string; name: string }>, key: DataSource) {
  return sources.find((item) => item.key === key)?.name ?? key;
}
