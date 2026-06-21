import {
  CheckCircle2,
  Database,
  LayoutDashboard,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProfileConfigPanel, type ProfileConfigSection } from "./profile-config-panel";
import type { RPortfolioStyleMode } from "../theme/r-theme";
import type { DataSource, MarketAnalysisReport, ProfileSummary } from "../lib/types";

export type ConfigPanelSection = "global" | ProfileConfigSection;

type SettingsPanelProps = {
  activeAnalysisProfile: string;
  activeSection: ConfigPanelSection;
  configProfile: string;
  dataSources: Array<{ key: DataSource; name: string; description: string; requiresConfig: boolean }>;
  defaultProfile: string;
  defaultSource: DataSource;
  onActiveSectionChange: (section: ConfigPanelSection) => void;
  onApplyDefaultProfile: () => void;
  onApplyDefaultSource: () => void;
  onOpenChange: (open: boolean) => void;
  onProfileChange: (profile: string) => void;
  onProfilesChanged: () => Promise<ProfileSummary[]>;
  onRefresh: () => void;
  onSetDefaultProfile: (profile: string) => void;
  onSetDefaultSource: (source: DataSource) => void;
  onSetStyleMode: (mode: RPortfolioStyleMode) => void;
  onUseProfile: (profile: string) => void;
  open: boolean;
  profile: string;
  profiles: ProfileSummary[];
  report: MarketAnalysisReport;
  source: DataSource;
  styleMode: RPortfolioStyleMode;
};

const SETTINGS_SECTIONS: Array<{
  key: ConfigPanelSection;
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  { key: "global", label: "全局", detail: "默认偏好与界面", icon: LayoutDashboard },
  { key: "profile", label: "Profile", detail: "管理、编辑、校验", icon: SlidersHorizontal },
  { key: "generate", label: "生成", detail: "基金代码与导入", icon: Sparkles },
];

const SECTION_COPY: Record<ConfigPanelSection, { title: string; description: string }> = {
  global: {
    title: "默认偏好与界面",
    description: "只管理启动偏好、数据源和工作台色调；点击应用后才影响当前分析。",
  },
  profile: {
    title: "Profile 管理与编辑",
    description: "维护可复用的交易分析协议，保存前可校验规则和文案配置。",
  },
  generate: {
    title: "从基金资料生成草稿",
    description: "先生成草稿，再校验保存；适合快速建立基金或 ETF Profile。",
  },
};

export function SettingsPanel({
  activeAnalysisProfile,
  activeSection,
  configProfile,
  dataSources,
  defaultProfile,
  defaultSource,
  onActiveSectionChange,
  onApplyDefaultProfile,
  onApplyDefaultSource,
  onOpenChange,
  onProfileChange,
  onProfilesChanged,
  onRefresh,
  onSetDefaultProfile,
  onSetDefaultSource,
  onSetStyleMode,
  onUseProfile,
  open,
  profile,
  profiles,
  report,
  source,
  styleMode,
}: SettingsPanelProps) {
  const activeCopy = SECTION_COPY[activeSection];
  const activeProfileConfigSection: ProfileConfigSection = activeSection === "global" ? "profile" : activeSection;
  const defaultProfileName = profiles.find((item) => item.key === defaultProfile)?.name ?? defaultProfile;
  const defaultSourceName = dataSources.find((item) => item.key === defaultSource)?.name ?? defaultSource;
  const profileOptions = profiles.length
    ? profiles
    : [{ key: profile, name: report.profileName, market: report.profileMarket, description: "", builtin: false }];
  const sourceOptions = dataSources.length
    ? dataSources
    : [{ key: source, name: source, description: "", requiresConfig: false }];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="settings-sheet sm:max-w-none">
        <SheetHeader className="settings-sheet-head">
          <div className="settings-sheet-title">
            <span>设置</span>
            <SheetTitle>配置工作台</SheetTitle>
            <SheetDescription>{report.profileName} · {report.sourceLabel}</SheetDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭设置面板" onClick={() => onOpenChange(false)}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>关闭设置</TooltipContent>
          </Tooltip>
        </SheetHeader>

        <Separator />

        <Tabs value={activeSection} onValueChange={(value) => onActiveSectionChange(value as ConfigPanelSection)} className="settings-workbench">
          <TabsList variant="line" className="settings-section-nav" aria-label="设置分类">
            {SETTINGS_SECTIONS.map((section) => {
              const SectionIcon = section.icon;
              return (
                <TabsTrigger key={section.key} value={section.key} className="settings-section-tab">
                  <SectionIcon />
                  <span>
                    <strong>{section.label}</strong>
                    <small>{section.detail}</small>
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="settings-section-body">
            <header className="settings-section-hero">
              <div>
                <span>当前设置</span>
                <h2>{activeCopy.title}</h2>
                <p>{activeCopy.description}</p>
              </div>
              <div className="settings-context-pills" aria-label="当前工作台上下文">
                <em>{report.profileMarket.toUpperCase()}</em>
                <em>{styleMode === "light" ? "亮色" : "暗色"}</em>
              </div>
            </header>

            {activeSection === "global" ? (
              <section className="settings-global-panel" aria-label="全局设置">
                <Card className="settings-appearance-card">
                  <CardHeader>
                    <CardTitle>工作台色调</CardTitle>
                    <CardDescription>
                      {styleMode === "light" ? "冷白蓝灰，适合配置与录入。" : "石墨低亮度，适合长时间盯盘。"}
                    </CardDescription>
                    <CardAction>
                      <div className="settings-mode-icons" aria-hidden="true">
                        <Moon className={cn(styleMode === "dark" && "is-active")} />
                        <Switch
                          checked={styleMode === "light"}
                          aria-label={styleMode === "light" ? "切换暗色模式" : "切换亮色模式"}
                          onCheckedChange={(checked) => onSetStyleMode(checked ? "light" : "dark")}
                        />
                        <Sun className={cn(styleMode === "light" && "is-active")} />
                      </div>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <div className="settings-note-row">
                      <span>布局一致</span>
                      <span>保留红绿信号</span>
                      <span>明暗友好</span>
                    </div>
                  </CardContent>
                </Card>

                <div className="settings-global-grid">
                  <Card className="settings-preference-card">
                    <CardHeader>
                      <CardTitle>默认 Profile</CardTitle>
                      <CardDescription>{defaultProfileName}</CardDescription>
                      <CardAction>
                        <CheckCircle2 />
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <label className="settings-field">
                        <span>启动时加载</span>
                        <select value={defaultProfile} aria-label="默认 Profile" onChange={(event) => onSetDefaultProfile(event.target.value)}>
                          {profileOptions.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>下次启动默认进入这套协议，不会自动覆盖当前结果。</p>
                      <Button type="button" variant="outline" onClick={onApplyDefaultProfile} disabled={activeAnalysisProfile === defaultProfile}>
                        应用到当前分析
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="settings-preference-card">
                    <CardHeader>
                      <CardTitle>默认数据源</CardTitle>
                      <CardDescription>{defaultSourceName}</CardDescription>
                      <CardAction>
                        <Database />
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <label className="settings-field">
                        <span>启动时拉取</span>
                        <select value={defaultSource} aria-label="默认数据源" onChange={(event) => onSetDefaultSource(event.target.value as DataSource)}>
                          {sourceOptions.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>控制默认数据入口；顶部仍可临时切换来源。</p>
                      <Button type="button" variant="outline" onClick={onApplyDefaultSource} disabled={source === defaultSource}>
                        应用到当前分析
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="settings-session-card">
                    <CardHeader>
                      <CardTitle>当前会话</CardTitle>
                      <CardDescription>{report.profileName}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <label className="settings-field">
                        <span>分析 Profile</span>
                        <Input value={report.profileKey} readOnly aria-label="当前分析 Profile" />
                      </label>
                      <label className="settings-field">
                        <span>数据源</span>
                        <Input value={source} readOnly aria-label="当前数据源" />
                      </label>
                    </CardContent>
                  </Card>
                </div>
              </section>
            ) : null}

            <div className={cn("settings-profile-panel", activeSection === "global" && "is-hidden")}>
              <ProfileConfigPanel
                profile={configProfile}
                activeAnalysisProfile={activeAnalysisProfile}
                profiles={profiles}
                report={report}
                activeSection={activeProfileConfigSection}
                hidden={activeSection === "global"}
                onProfileChange={onProfileChange}
                onApplyProfile={onUseProfile}
                onProfilesChanged={onProfilesChanged}
                onRefresh={onRefresh}
                onSectionChange={onActiveSectionChange}
              />
            </div>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
