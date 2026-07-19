import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProfileConfigPanel, type ProfileConfigSection } from "./profile-config-panel";
import type { RPortfolioStyleMode } from "../theme/r-theme";
import type { DataSource, MarketAnalysisReport, ProfileSummary } from "../lib/types";
import type { HoldingRecord } from "../lib/holdings";
import type { PortfolioValuationSettings } from "../lib/portfolio-valuation";
import {
  fundFeesFor,
  updateFundFeeOverride,
  type FundExecutionPolicy,
} from "../lib/fund-execution-policy";
import "../styles/pages/settings.css";
import "../styles/pages/settings-polish.css";

export type ConfigPanelSection = "global" | ProfileConfigSection;

type SettingsPanelProps = {
  activeAnalysisProfile: string;
  activeSection: ConfigPanelSection;
  configProfile: string;
  dataSources: Array<{ key: DataSource; name: string; description: string; requiresConfig: boolean }>;
  defaultProfile: string;
  defaultSource: DataSource;
  fundExecutionPolicy: FundExecutionPolicy;
  fundHoldings: HoldingRecord[];
  portfolioValuation: PortfolioValuationSettings;
  onActiveSectionChange: (section: ConfigPanelSection) => void;
  onApplyDefaultProfile: () => void;
  onFundExecutionPolicyChange: (policy: FundExecutionPolicy) => void;
  onPortfolioValuationChange: (valuation: PortfolioValuationSettings) => void;
  onOpenChange: (open: boolean) => void;
  onProfileChange: (profile: string) => void;
  onProfilesChanged: () => Promise<ProfileSummary[]>;
  onRefresh: () => void;
  onSetDefaultProfile: (profile: string) => void;
  onSetDefaultSource: (source: DataSource) => void;
  onSourceChange: (source: DataSource) => void;
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
  fundExecutionPolicy,
  fundHoldings,
  portfolioValuation,
  onActiveSectionChange,
  onApplyDefaultProfile,
  onFundExecutionPolicyChange,
  onPortfolioValuationChange,
  onOpenChange,
  onProfileChange,
  onProfilesChanged,
  onRefresh,
  onSetDefaultProfile,
  onSetDefaultSource,
  onSourceChange,
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
  const currentSourceName = dataSources.find((item) => item.key === source)?.name ?? source;
  const profileOptions = profiles.length
    ? profiles
    : [{ key: profile, name: report.profileName, market: report.profileMarket, description: "", builtin: false }];
  const sourceOptions = dataSources.length
    ? dataSources
    : [{ key: source, name: source, description: "", requiresConfig: false }];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="settings-dialog" mobileMode="modal" size="workspace">
        <DialogHeader className="settings-sheet-head">
          <div className="settings-sheet-title">
            <span>设置</span>
            <DialogTitle>配置工作台</DialogTitle>
            <DialogDescription>{report.profileName} · {report.sourceLabel}</DialogDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭设置面板" onClick={() => onOpenChange(false)}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>关闭设置</TooltipContent>
          </Tooltip>
        </DialogHeader>

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
                      <CardTitle>全局数据源</CardTitle>
                      <CardDescription>当前：{currentSourceName}</CardDescription>
                      <CardAction>
                        <Database />
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <label className="settings-field">
                        <span>当前会话</span>
                        <select value={source} aria-label="当前数据源" onChange={(event) => onSourceChange(event.target.value as DataSource)}>
                          {sourceOptions.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>切换后作用于持仓、组合决策和量化交易；启动默认值为 {defaultSourceName}。</p>
                      <Button type="button" variant="outline" onClick={() => onSetDefaultSource(source)} disabled={source === defaultSource}>
                        设为启动默认
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="settings-preference-card">
                    <CardHeader>
                      <CardTitle>组合估值</CardTitle>
                      <CardDescription>人民币 / 美元统一权重与预算</CardDescription>
                      <CardAction>
                        <CircleDollarSign />
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <div className="settings-fund-policy-grid">
                        <label className="settings-field">
                          <span>基准币种</span>
                          <select
                            value={portfolioValuation.baseCurrency}
                            aria-label="组合基准币种"
                            onChange={(event) => onPortfolioValuationChange({
                              ...portfolioValuation,
                              baseCurrency: event.target.value === "USD" ? "USD" : "CNY",
                            })}
                          >
                            <option value="CNY">CNY 人民币</option>
                            <option value="USD">USD 美元</option>
                          </select>
                        </label>
                        <label className="settings-field">
                          <span>USD/CNY</span>
                          <Input
                            type="number"
                            min="0.0001"
                            max="99"
                            step="0.0001"
                            value={portfolioValuation.usdCnyRate ?? ""}
                            aria-label="美元兑人民币汇率"
                            placeholder="1 美元对应人民币"
                            onChange={(event) => onPortfolioValuationChange({
                              ...portfolioValuation,
                              usdCnyRate: event.target.value ? Number(event.target.value) : null,
                            })}
                          />
                        </label>
                        <label className="settings-field">
                          <span>汇率日期</span>
                          <Input
                            type="date"
                            value={portfolioValuation.fxAsOf}
                            aria-label="汇率日期"
                            onChange={(event) => onPortfolioValuationChange({
                              ...portfolioValuation,
                              fxAsOf: event.target.value,
                            })}
                          />
                        </label>
                      </div>
                      <p>汇率表示 1 USD 对应的 CNY。缺少汇率或日期过期时，不生成增加风险的交易票。</p>
                    </CardContent>
                  </Card>

                  <Card className="settings-preference-card settings-fund-execution-card">
                    <CardHeader>
                      <CardTitle>场外基金成交规则</CardTitle>
                      <CardDescription>截止时间、到账周期、默认费率与产品覆盖</CardDescription>
                      <CardAction>
                        <Clock3 />
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <div className="settings-fund-policy-grid">
                        <label className="settings-field">
                          <span>当日净值截止</span>
                          <Input
                            type="time"
                            value={fundExecutionPolicy.cutoffTime}
                            aria-label="场外基金当日净值截止时间"
                            onChange={(event) => onFundExecutionPolicyChange({
                              ...fundExecutionPolicy,
                              cutoffTime: event.target.value,
                            })}
                          />
                        </label>
                        <label className="settings-field">
                          <span>默认申购费（%）</span>
                          <Input
                            type="number"
                            min="0"
                            max="10"
                            step="0.01"
                            value={fundExecutionPolicy.defaultBuyFeeRate * 100}
                            aria-label="场外基金默认申购费率"
                            onChange={(event) => onFundExecutionPolicyChange({
                              ...fundExecutionPolicy,
                              defaultBuyFeeRate: Number(event.target.value) / 100,
                            })}
                          />
                        </label>
                        <label className="settings-field">
                          <span>默认赎回费（%）</span>
                          <Input
                            type="number"
                            min="0"
                            max="10"
                            step="0.01"
                            value={fundExecutionPolicy.defaultSellFeeRate * 100}
                            aria-label="场外基金默认赎回费率"
                            onChange={(event) => onFundExecutionPolicyChange({
                              ...fundExecutionPolicy,
                              defaultSellFeeRate: Number(event.target.value) / 100,
                            })}
                          />
                        </label>
                        <label className="settings-field">
                          <span>赎回到账（交易日）</span>
                          <Input
                            type="number"
                            min="1"
                            max="10"
                            step="1"
                            value={fundExecutionPolicy.defaultRedemptionSettlementDays}
                            aria-label="场外基金默认赎回到账交易日"
                            onChange={(event) => onFundExecutionPolicyChange({
                              ...fundExecutionPolicy,
                              defaultRedemptionSettlementDays: Number(event.target.value),
                            })}
                          />
                        </label>
                      </div>
                      <p>15:00 前使用当日净值，之后顺延到下一交易日；赎回净值确认与资金到账分开计算，默认到账周期可按产品覆盖。</p>
                      {fundHoldings.length ? (
                        <div className="settings-fund-overrides" aria-label="基金产品规则覆盖">
                          <header>
                            <span>产品规则覆盖</span>
                            <small>{fundHoldings.length} 只基金</small>
                          </header>
                          {fundHoldings.map((holding) => {
                            const fees = fundFeesFor(fundExecutionPolicy, holding.symbol);
                            return (
                              <div key={holding.id} className="settings-fund-override-row">
                                <span title={holding.name}>
                                  <strong>{holding.symbol}</strong>
                                  <small>{holding.name}</small>
                                </span>
                                <label>
                                  <span>申购%</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="0.01"
                                    value={fees.buyFeeRate * 100}
                                    aria-label={`${holding.symbol} 申购费率`}
                                    onChange={(event) => onFundExecutionPolicyChange(updateFundFeeOverride(
                                      fundExecutionPolicy,
                                      holding.symbol,
                                      { buyFeeRate: Number(event.target.value) / 100 },
                                    ))}
                                  />
                                </label>
                                <label>
                                  <span>赎回%</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="0.01"
                                    value={fees.sellFeeRate * 100}
                                    aria-label={`${holding.symbol} 赎回费率`}
                                    onChange={(event) => onFundExecutionPolicyChange(updateFundFeeOverride(
                                      fundExecutionPolicy,
                                      holding.symbol,
                                      { sellFeeRate: Number(event.target.value) / 100 },
                                    ))}
                                  />
                                </label>
                                <label>
                                  <span>到账 T+</span>
                                  <Input
                                    type="number"
                                    min="1"
                                    max="10"
                                    step="1"
                                    value={fees.redemptionSettlementDays}
                                    aria-label={`${holding.symbol} 赎回到账交易日`}
                                    onChange={(event) => onFundExecutionPolicyChange(updateFundFeeOverride(
                                      fundExecutionPolicy,
                                      holding.symbol,
                                      { redemptionSettlementDays: Number(event.target.value) },
                                    ))}
                                  />
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
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
      </DialogContent>
    </Dialog>
  );
}
