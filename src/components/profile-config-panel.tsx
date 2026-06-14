import AddCircleRoundedIcon from "@mui/icons-material/AddCircleRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import FileUploadRoundedIcon from "@mui/icons-material/FileUploadRounded";
import FolderSpecialRoundedIcon from "@mui/icons-material/FolderSpecialRounded";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import ManageSearchRoundedIcon from "@mui/icons-material/ManageSearchRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import { Button } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { exportProfileConfig, importProfileConfig, lookupFundProfileSeed, validateProfileConfig } from "../lib/analysis";
import type { FundProfileSeed, MandateConstraint, MarketAnalysisReport, ProfileFund, ProfileSummary, ProfileValidationReport } from "../lib/types";

type ProfileConfigPanelProps = {
  profile: string;
  activeAnalysisProfile: string;
  profiles: ProfileSummary[];
  report: MarketAnalysisReport;
  activeSection: ProfileConfigSection;
  hidden?: boolean;
  onProfileChange: (value: string) => void;
  onApplyProfile: (value: string) => void;
  onProfilesChanged: () => Promise<ProfileSummary[]>;
  onRefresh: () => void;
  onSectionChange?: (value: ProfileConfigSection) => void;
};

export type ProfileConfigSection = "profile" | "generate";

type ProfileDraft = {
  key: string;
  name: string;
  market: string;
  description: string;
  benchmarkSymbol: string;
  fundCode: string;
  fundName: string;
  fundType: string;
  fundManager: string;
  fundIssuer: string;
  fundNavSymbol: string;
  fundHoldingsAsOf: string;
  fundHoldingsSource: string;
  fundNotesText: string;
  importAliasesText: string;
  importQualityText: string;
  importAnalysisText: string;
  objective: string;
  benchmarkName: string;
  timeHorizon: string;
  riskBudget: string;
  maxDrawdown: string;
  targetGrossExposure: string;
  riskScoreLimit: string;
  constraintsText: string;
  notesText: string;
  holdingsText: string;
  rulesText: string;
};

type SymbolDraft = {
  symbol: string;
  label: string;
  role: string;
  weight: number;
  sector: string;
  style: string;
  exposure: string;
  yahooSymbol: string;
};

type RuleDraft = {
  dimensionKey: string;
  dimensionLabel: string;
  factor: string;
  dimensionWeight: number;
  rule: JsonObject;
};

type FundHoldingsImport = {
  holdings: SymbolDraft[];
  fundDraft: Partial<ProfileDraft>;
  warnings: string[];
  diagnostics: FundImportDiagnostic[];
  analysis?: FundImportAnalysis;
  sourceName: string;
  sourceType: "csv" | "json";
  rowsRead: number;
  ignoredRows: number;
  recognizedColumns: string[];
  fundFields: string[];
  customAliasFields: string[];
  totalWeight: number;
};

type FundImportDiagnostic = {
  key: string;
  label: string;
  value: string;
  tone: "positive" | "caution" | "negative";
  message: string;
};

type FundImportAnalysisTone = "positive" | "caution" | "negative";

type FundImportAnalysisItem = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: FundImportAnalysisTone;
};

type FundImportAnalysis = {
  tone: FundImportAnalysisTone;
  label: string;
  headline: string;
  items: FundImportAnalysisItem[];
};

type AiRecipeDiff = {
  key: keyof ProfileDraft;
  label: string;
  before: string;
  after: string;
  tone: "positive" | "caution" | "neutral";
};

type AiRecipeImport = {
  sourceName: string;
  schema: string;
  intent: string;
  draftPatch: Partial<ProfileDraft>;
  diffs: AiRecipeDiff[];
  warnings: string[];
  ignoredSections: string[];
};

export function ProfileConfigPanel({
  profile,
  activeAnalysisProfile,
  profiles,
  report,
  activeSection,
  hidden,
  onProfileChange,
  onApplyProfile,
  onProfilesChanged,
  onRefresh,
  onSectionChange,
}: ProfileConfigPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const holdingsInputRef = useRef<HTMLInputElement | null>(null);
  const recipeInputRef = useRef<HTMLInputElement | null>(null);
  const builderFormRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Profile 可导出为 JSON，也可导入到本机自定义目录。");
  const current = profiles.find((item) => item.key === profile);
  const activeAnalysis = profiles.find((item) => item.key === activeAnalysisProfile);
  const editingAnalysisProfile = profile === activeAnalysisProfile;
  const profileList = profiles.length ? profiles : current ? [current] : [];
  const mandate = report.profileMandate;
  const fund = report.profileFund;
  const [draft, setDraft] = useState<ProfileDraft>(() => buildDraft(current, report, profile));
  const [baseProfile, setBaseProfile] = useState<JsonObject | null>(null);
  const [builderStatus, setBuilderStatus] = useState("从当前模板派生一个自定义 Profile，不覆盖内置模板。");
  const [validationReport, setValidationReport] = useState<ProfileValidationReport | null>(null);
  const [pendingImport, setPendingImport] = useState<FundHoldingsImport | null>(null);
  const [pendingRecipe, setPendingRecipe] = useState<AiRecipeImport | null>(null);
  const [fundLookupCode, setFundLookupCode] = useState("");
  const [fundLookupBusy, setFundLookupBusy] = useState(false);
  const [fundLookupStatus, setFundLookupStatus] = useState("先读取基金资料，再应用为草稿；保存后才会进入 Profile 库。");
  const [fundSeed, setFundSeed] = useState<FundProfileSeed | null>(null);
  const previewJson = useMemo(() => {
    return JSON.stringify(buildDraftPreview(draft, report, baseProfile), null, 2);
  }, [baseProfile, draft, report]);
  const portfolioDraftStats = useMemo(() => portfolioStats(draft), [draft]);
  const ruleDraftStats = useMemo(() => ruleStats(draft), [draft]);
  const draftKey = draft.key.trim() || "未命名";
  const draftName = draft.name.trim() || current?.name || report.profileName;
  const draftSavedInList = profiles.some((item) => item.key === draftKey && !item.builtin);
  const savedDraftProfile = profiles.find((item) => item.key === draftKey);
  const activeLibraryKey = savedDraftProfile ? savedDraftProfile.key : draftKey === profile ? profile : "";
  const draftSourceLabel = current
    ? `${current.builtin ? "内置模板" : "自定义模板"} · ${current.key}`
    : `当前分析 · ${profile}`;
  const draftMarketLabel = (draft.market.trim() || current?.market || report.profileMarket).toUpperCase();
  const generateHasDraft = Boolean(draft.fundCode.trim() || fundSeed || pendingImport || pendingRecipe);
  const generateStepOneClass = generateHasDraft ? "is-done" : "is-active";
  const generateStepTwoClass = validationReport ? (validationReport.valid ? "is-done" : "is-active") : generateHasDraft ? "is-active" : "";
  const generateStepThreeClass = draftSavedInList ? "is-done" : validationReport?.valid ? "is-active" : "";
  const generateValidationLabel = validationReport
    ? validationReport.valid ? "校验通过" : "需要处理"
    : `${portfolioDraftStats.count} 个符号 / ${ruleDraftStats.rules} 条规则`;

  useEffect(() => {
    setDraft(buildDraft(current, report, profile));
    setValidationReport(null);
    setPendingImport(null);
    setPendingRecipe(null);
    setFundLookupCode("");
    setFundSeed(null);
    setFundLookupStatus("先读取基金资料，再应用为草稿；保存后才会进入 Profile 库。");
    setBuilderStatus("从当前模板派生一个自定义 Profile，不覆盖内置模板。");
  }, [current, profile, report]);

  useEffect(() => {
    let cancelled = false;
    setBaseProfile(null);
    async function loadBaseProfile() {
      try {
        const bundle = await exportProfileConfig(profile);
        if (cancelled) return;
        const parsed = JSON.parse(bundle.json) as JsonObject;
        setBaseProfile(parsed);
        setDraft(buildDraftFromProfileConfig(parsed, current, report, profile));
      } catch {
        if (!cancelled) {
          setBaseProfile(null);
        }
      }
    }
    void loadBaseProfile();
    return () => {
      cancelled = true;
    };
  }, [profile, report]);

  async function handleExport() {
    setBusy(true);
    try {
      const latestDraft = draftFromForm(draft, builderFormRef.current);
      setDraft(latestDraft);
      const content = await buildProfileContent(latestDraft);
      const exportKey = latestDraft.key.trim() || profile;
      const exportName = latestDraft.name.trim() || current?.name || report.profileName;
      downloadJson(content, `${slugify(exportKey) || "profile"}.profile.json`);
      setStatus(`已生成当前草稿 ${exportName} 的 Profile JSON。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile 导出失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const content = await file.text();
      const imported = await importProfileConfig(content);
      await onProfilesChanged();
      onProfileChange(imported.key);
      setStatus(`已导入 ${imported.name}，已作为编辑模板；需要更新主界面时再应用到分析。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile 导入失败。");
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function handleImportHoldings(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const latestDraft = draftFromForm(draft, builderFormRef.current);
      const aliasValidation = validateImportAliasText(latestDraft.importAliasesText);
      if (aliasValidation) {
        setBuilderStatus(aliasValidation);
        return;
      }
      const qualityValidation = validateImportQualityText(latestDraft.importQualityText);
      if (qualityValidation) {
        setBuilderStatus(qualityValidation);
        return;
      }
      const analysisValidation = validateImportAnalysisTemplateText(latestDraft.importAnalysisText);
      if (analysisValidation) {
        setBuilderStatus(analysisValidation);
        return;
      }
      const content = await file.text();
      const parsed = parseFundHoldingsImport(content, file.name, latestDraft, report);
      if (!parsed.holdings.length) {
        setBuilderStatus("未识别到可导入的持仓行，请检查 CSV/JSON 字段。");
        return;
      }
      setDraft(latestDraft);
      setPendingImport(parsed);
      setValidationReport(null);
      onSectionChange?.("generate");
      setBuilderStatus(
        `已读取 ${parsed.sourceName}：识别 ${parsed.holdings.length} 条持仓，待确认后应用。`,
      );
    } catch (error) {
      setBuilderStatus(error instanceof Error ? error.message : "持仓导入失败。");
    } finally {
      setBusy(false);
      if (holdingsInputRef.current) {
        holdingsInputRef.current.value = "";
      }
    }
  }

  async function handleImportRecipe(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const latestDraft = draftFromForm(draft, builderFormRef.current);
      const content = await file.text();
      const parsed = parseAiRecipeImport(content, file.name, latestDraft);
      setDraft(latestDraft);
      setPendingRecipe(parsed);
      setPendingImport(null);
      setValidationReport(null);
      onSectionChange?.("generate");
      setBuilderStatus(
        `已读取 ${parsed.sourceName}：生成 ${parsed.diffs.length} 项草稿变更，等待确认。`,
      );
    } catch (error) {
      setBuilderStatus(error instanceof Error ? error.message : "AI Recipe 导入失败。");
    } finally {
      setBusy(false);
      if (recipeInputRef.current) {
        recipeInputRef.current.value = "";
      }
    }
  }

  function handleApplyHoldingsImport() {
    if (!pendingImport) return;
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    const nextDraft: ProfileDraft = {
      ...latestDraft,
      ...pendingImport.fundDraft,
      holdingsText: holdingsDraftsToText(mergeImportedHoldings(latestDraft.holdingsText, pendingImport.holdings, latestDraft.benchmarkSymbol)),
    };
    setDraft(nextDraft);
    setPendingImport(null);
    setPendingRecipe(null);
    setValidationReport(null);
    onSectionChange?.("profile");
    setBuilderStatus(`已应用 ${pendingImport.holdings.length} 条持仓到草稿；下一步校验，通过后保存为 Profile。`);
  }

  function handleApplyRecipeImport() {
    if (!pendingRecipe) return;
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    setDraft({
      ...latestDraft,
      ...pendingRecipe.draftPatch,
    });
    setPendingRecipe(null);
    setValidationReport(null);
    onSectionChange?.("profile");
    setBuilderStatus("已应用 AI Recipe 到草稿；下一步校验，通过后保存为 Profile。");
  }

  function handleCancelRecipeImport() {
    setPendingRecipe(null);
    setBuilderStatus("已取消本次 AI Recipe 导入，草稿未改变。");
  }

  function handleCancelHoldingsImport() {
    setPendingImport(null);
    setBuilderStatus("已取消本次持仓导入，草稿未改变。");
  }

  async function handleLookupFundSeed() {
    const code = fundLookupCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setFundLookupStatus("基金代码需要是 6 位数字。");
      return;
    }
    setFundLookupBusy(true);
    setFundLookupStatus("正在读取公开基金资料...");
    try {
      const seed = await lookupFundProfileSeed(code);
      setFundSeed(seed);
      setFundLookupStatus(`已读取 ${seed.name}，点击“应用为草稿”后继续校验。`);
    } catch (error) {
      setFundSeed(null);
      setFundLookupStatus(error instanceof Error ? error.message : "基金资料读取失败。");
    } finally {
      setFundLookupBusy(false);
    }
  }

  function handleApplyFundSeed() {
    if (!fundSeed) return;
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    const nextDraft = applyFundSeedToDraft(latestDraft, fundSeed, profiles);
    setDraft(nextDraft);
    setPendingImport(null);
    setPendingRecipe(null);
    setValidationReport(null);
    setBuilderStatus(`草稿已生成：${fundSeed.name}。下一步校验，通过后保存为 Profile。`);
    setFundLookupStatus("已应用为草稿；底部保存后才会写入 Profile 库。");
    onSectionChange?.("profile");
  }

  async function handleSaveDraft() {
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    setDraft(latestDraft);
    const validation = validateDraft(latestDraft, profiles);
    if (validation) {
      setBuilderStatus(validation);
      return;
    }

    setBusy(true);
    try {
      const content = await buildProfileContent(latestDraft);
      const reportResult = await validateProfileConfig(content);
      setValidationReport(reportResult);
      if (!reportResult.valid) {
        setBuilderStatus(reportResult.summary);
        return;
      }
      const imported = await importProfileConfig(content);
      await onProfilesChanged();
      onProfileChange(imported.key);
      setStatus(`已保存 ${imported.name}，已作为编辑模板；主分析暂不切换。`);
      setBuilderStatus(`${reportResult.summary} 自定义 Profile 已写入本机 Profile 库，可在 Profile 页应用到分析。`);
    } catch (error) {
      setBuilderStatus(error instanceof Error ? error.message : "Profile Builder 保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleValidateDraft() {
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    setDraft(latestDraft);
    const validation = validateDraft(latestDraft, profiles);
    if (validation) {
      const localReport = localValidationReport(validation);
      setValidationReport(localReport);
      setBuilderStatus(localReport.summary);
      onSectionChange?.("profile");
      return;
    }
    setBusy(true);
    try {
      const content = await buildProfileContent(latestDraft);
      const reportResult = await validateProfileConfig(content);
      setValidationReport(reportResult);
      setBuilderStatus(reportResult.summary);
      onSectionChange?.("profile");
    } catch (error) {
      setBuilderStatus(error instanceof Error ? error.message : "Profile 校验失败。");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(key: keyof ProfileDraft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setValidationReport(null);
    setPendingRecipe(null);
  }

  function applyImportQualityPreset(preset: ImportQualityPreset) {
    setDraft((previous) => ({
      ...previous,
      importQualityText: importQualityPresetToText(preset),
    }));
    setValidationReport(null);
    setPendingImport(null);
    setPendingRecipe(null);
    setBuilderStatus(`已套用 ${preset.label} 的导入质检阈值，可继续手动微调。`);
  }

  async function handleCopyRecipePrompt() {
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    setDraft(latestDraft);
    try {
      await copyTextToClipboard(buildAiRecipePrompt(latestDraft, report));
      setBuilderStatus("已复制 AI Recipe 生成提示词；生成结果应保持 JSON-only，导入前仍会预览 diff。");
    } catch (error) {
      setBuilderStatus(error instanceof Error ? error.message : "AI Recipe 提示词复制失败。");
    }
  }

  async function handleCopyRecipeExample() {
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    setDraft(latestDraft);
    try {
      await copyTextToClipboard(JSON.stringify(buildAiRecipeExample(latestDraft, report), null, 2));
      setBuilderStatus("已复制 AI Recipe 示例 JSON，可作为生成目标或导入测试样本。");
    } catch (error) {
      setBuilderStatus(error instanceof Error ? error.message : "AI Recipe 示例复制失败。");
    }
  }

  function handleDownloadRecipeExample() {
    const latestDraft = draftFromForm(draft, builderFormRef.current);
    setDraft(latestDraft);
    const filename = `${latestDraft.key.trim() || "rportfolio"}.ai-recipe.example.json`;
    downloadJson(JSON.stringify(buildAiRecipeExample(latestDraft, report), null, 2), filename);
    setBuilderStatus(`已生成 ${filename}。`);
  }

  function resetDraft() {
    setDraft(baseProfile ? buildDraftFromProfileConfig(baseProfile, current, report, profile) : buildDraft(current, report, profile));
    setValidationReport(null);
    setPendingImport(null);
    setPendingRecipe(null);
    setBuilderStatus("已恢复为当前模板的派生草稿。");
  }

  function handleApplyToAnalysis() {
    onApplyProfile(profile);
    setStatus(`已将 ${current?.name ?? profile} 应用到主分析，等待重新评分。`);
  }

  async function buildProfileContent(latestDraft: ProfileDraft) {
    const base = baseProfile ?? (JSON.parse((await exportProfileConfig(profile)).json) as JsonObject);
    const next = applyDraftToProfile(base, latestDraft, report);
    return JSON.stringify(next, null, 2);
  }

  const showSubmitBar = true;

  return (
    <section className={`panel profile-config-panel is-${activeSection}`} hidden={hidden}>
      <div className="panel-head">
        <div className="panel-title">
          <FolderSpecialRoundedIcon fontSize="inherit" />
          <h2>Profile 配置</h2>
        </div>
        <span className="panel-kicker">导入 / 导出 / 文案协议</span>
      </div>

      <div className={`profile-config-board is-${activeSection}`}>
        {activeSection === "profile" ? (
          <>
            <div className="profile-config-summary-stack">
              <article className="profile-config-hero">
                <div className="profile-draft-head">
                  <div>
                    <span>当前草稿</span>
                    <strong>{draftName}</strong>
                  </div>
                  <em className={draftSavedInList ? "is-saved" : "is-draft"}>
                    {draftSavedInList ? "已保存" : "未保存"}
                  </em>
                </div>
                <p>{draft.description.trim() || current?.description || "用于市场状态、规则评分、持仓权重和状态文案的统一配置。"}</p>
                <dl className="profile-draft-facts">
                  <div>
                    <dt>Key</dt>
                    <dd>{draftKey}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd>{draftSourceLabel}</dd>
                  </div>
                  <div>
                    <dt>市场</dt>
                    <dd>{draftMarketLabel}</dd>
                  </div>
                  <div>
                    <dt>基金</dt>
                    <dd>{draft.fundName.trim() || draft.fundCode.trim() || "未设置"}</dd>
                  </div>
                </dl>
                <div className="profile-config-meta">
                  <em>{portfolioDraftStats.count} 个符号 / {portfolioDraftStats.totalWeight}%</em>
                  <em>{ruleDraftStats.dimensions} 维 / {ruleDraftStats.rules} 条规则</em>
                  <em>{editingAnalysisProfile ? "分析中" : `分析：${activeAnalysis?.name ?? activeAnalysisProfile}`}</em>
                  <em>{draftSavedInList ? "右侧列表可见" : "保存后进入列表"}</em>
                </div>
              </article>

              <article className="profile-config-actions">
                <span>草稿操作</span>
                <div>
                  <Button startIcon={<DownloadRoundedIcon />} onClick={handleExport} disabled={busy}>
                    导出编辑
                  </Button>
                  <Button startIcon={<FileUploadRoundedIcon />} onClick={() => inputRef.current?.click()} disabled={busy}>
                    导入 Profile
                  </Button>
                  <Button startIcon={<ManageSearchRoundedIcon />} onClick={handleApplyToAnalysis} disabled={busy || editingAnalysisProfile}>
                    应用到分析
                  </Button>
                  <Button startIcon={<RestartAltRoundedIcon />} onClick={onRefresh} disabled={busy}>
                    重算
                  </Button>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(event) => void handleImport(event.target.files?.[0])}
                />
                <p>{status}</p>
              </article>
            </div>

            <article className="profile-config-list">
              <div className="profile-list-head">
                <div>
                  <span>Profile 库</span>
                  <strong>{profileList.length} 个已保存模板</strong>
                </div>
                <em>草稿保存后出现</em>
              </div>
              <p>列表只显示已保存 Profile；点击会切换编辑来源，不会改变外层分析。</p>
              {profileList.length ? (
                profileList.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={[
                      item.key === activeLibraryKey ? "is-active" : "",
                      item.key === profile && item.key !== activeLibraryKey ? "is-editing-source" : "",
                      item.key === activeAnalysisProfile ? "is-current-analysis" : "",
                    ].filter(Boolean).join(" ") || undefined}
                    onClick={() => onProfileChange(item.key)}
                    aria-current={item.key === activeLibraryKey ? "true" : undefined}
                  >
                    <small>{item.key}</small>
                    <strong>{item.name}</strong>
                    <em>
                      {item.key === activeLibraryKey
                        ? "编辑中"
                        : item.key === activeAnalysisProfile
                          ? "分析中"
                          : item.key === profile
                            ? "来源"
                            : item.builtin ? "内置" : "自定义"}
                    </em>
                  </button>
                ))
              ) : (
                <p>还没有可用 Profile。</p>
              )}
            </article>
          </>
        ) : null}

        {activeSection === "profile" ? (
          <>
            <article className="profile-config-mandate">
              <div>
                <span>投资委托</span>
                <strong className={`is-${mandate.riskAlignmentTone}`}>{mandate.riskAlignment}</strong>
              </div>
              <p>{mandate.objective}</p>
              <dl>
                <div>
                  <dt>基准</dt>
                  <dd>{mandate.benchmarkName}</dd>
                </div>
                <div>
                  <dt>币种</dt>
                  <dd>{mandate.baseCurrency}</dd>
                </div>
                <div>
                  <dt>周期</dt>
                  <dd>{mandate.timeHorizon}</dd>
                </div>
                <div>
                  <dt>回撤</dt>
                  <dd>{mandate.maxDrawdown}</dd>
                </div>
                <div>
                  <dt>敞口</dt>
                  <dd>{mandate.targetGrossExposure}</dd>
                </div>
                <div>
                  <dt>再平衡</dt>
                  <dd>{mandate.rebalanceCadence}</dd>
                </div>
              </dl>
              <div className="mandate-constraints">
                {mandate.constraints.slice(0, 4).map((item) => (
                  <article key={item.key} className={`is-${item.tone}`}>
                    <GavelRoundedIcon fontSize="inherit" />
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </article>
                ))}
              </div>
            </article>

            <FundInfoCard fund={fund} portfolioWeight={report.portfolioProfile.totalWeight} />

            <div className="profile-builder-layout">
              <article className="profile-builder-card">
                <div className="profile-builder-head">
                  <div>
                    <span>Profile Builder</span>
                    <strong>派生基金模板</strong>
                  </div>
                  <em>{current?.builtin ? "另存为自定义" : "更新自定义"}</em>
                </div>
                <div ref={builderFormRef} className="profile-builder-form">
            <label>
              <span>Key</span>
              <input
                name="key"
                value={draft.key}
                spellCheck={false}
                onChange={(event) => updateDraft("key", event.target.value)}
              />
            </label>
            <label>
              <span>名称</span>
              <input name="name" value={draft.name} autoComplete="off" onChange={(event) => updateDraft("name", event.target.value)} />
            </label>
            <label>
              <span>市场</span>
              <input name="market" value={draft.market} onChange={(event) => updateDraft("market", event.target.value)} />
            </label>
            <label>
              <span>基准代码</span>
              <input
                name="benchmarkSymbol"
                value={draft.benchmarkSymbol}
                spellCheck={false}
                onChange={(event) => updateDraft("benchmarkSymbol", event.target.value)}
              />
            </label>
            <label>
              <span>基准名称</span>
              <input
                name="benchmarkName"
                value={draft.benchmarkName}
                onChange={(event) => updateDraft("benchmarkName", event.target.value)}
              />
            </label>
            <label>
              <span>基金代码</span>
              <input
                name="fundCode"
                value={draft.fundCode}
                spellCheck={false}
                onChange={(event) => updateDraft("fundCode", event.target.value)}
              />
            </label>
            <label>
              <span>基金名称</span>
              <input name="fundName" value={draft.fundName} onChange={(event) => updateDraft("fundName", event.target.value)} />
            </label>
            <label>
              <span>基金类型</span>
              <input
                name="fundType"
                value={draft.fundType}
                placeholder="active_equity / etf / qdii"
                onChange={(event) => updateDraft("fundType", event.target.value)}
              />
            </label>
            <label>
              <span>净值代码</span>
              <input
                name="fundNavSymbol"
                value={draft.fundNavSymbol}
                spellCheck={false}
                onChange={(event) => updateDraft("fundNavSymbol", event.target.value)}
              />
            </label>
            <label>
              <span>基金经理</span>
              <input name="fundManager" value={draft.fundManager} onChange={(event) => updateDraft("fundManager", event.target.value)} />
            </label>
            <label>
              <span>管理人</span>
              <input name="fundIssuer" value={draft.fundIssuer} onChange={(event) => updateDraft("fundIssuer", event.target.value)} />
            </label>
            <label>
              <span>持仓披露日</span>
              <input
                name="fundHoldingsAsOf"
                value={draft.fundHoldingsAsOf}
                placeholder="YYYY-MM-DD"
                onChange={(event) => updateDraft("fundHoldingsAsOf", event.target.value)}
              />
            </label>
            <label>
              <span>持仓来源</span>
              <input
                name="fundHoldingsSource"
                value={draft.fundHoldingsSource}
                placeholder="季报 / 手工导入 / 官方披露"
                onChange={(event) => updateDraft("fundHoldingsSource", event.target.value)}
              />
            </label>
            <label>
              <span>风险上限</span>
              <input
                name="riskScoreLimit"
                inputMode="numeric"
                value={draft.riskScoreLimit}
                onChange={(event) => updateDraft("riskScoreLimit", event.target.value)}
              />
            </label>
            <label>
              <span>目标敞口</span>
              <input
                name="targetGrossExposure"
                value={draft.targetGrossExposure}
                onChange={(event) => updateDraft("targetGrossExposure", event.target.value)}
              />
            </label>
            <label>
              <span>周期</span>
              <input
                name="timeHorizon"
                value={draft.timeHorizon}
                onChange={(event) => updateDraft("timeHorizon", event.target.value)}
              />
            </label>
            <label>
              <span>回撤预算</span>
              <input
                name="maxDrawdown"
                value={draft.maxDrawdown}
                onChange={(event) => updateDraft("maxDrawdown", event.target.value)}
              />
            </label>
            <label className="is-wide">
              <span>描述</span>
              <textarea
                name="description"
                rows={2}
                value={draft.description}
                onChange={(event) => updateDraft("description", event.target.value)}
              />
            </label>
            <label className="is-wide">
              <span>投资目标</span>
              <textarea
                name="objective"
                rows={3}
                value={draft.objective}
                onChange={(event) => updateDraft("objective", event.target.value)}
              />
            </label>
            <label className="is-wide">
              <span>风险预算</span>
              <textarea
                name="riskBudget"
                rows={2}
                value={draft.riskBudget}
                onChange={(event) => updateDraft("riskBudget", event.target.value)}
              />
            </label>
            <label className="is-wide">
              <span>基金备注</span>
              <textarea
                name="fundNotesText"
                rows={2}
                value={draft.fundNotesText}
                onChange={(event) => updateDraft("fundNotesText", event.target.value)}
              />
            </label>
            <label className="is-wide">
              <span>导入字段映射</span>
              <textarea
                name="importAliasesText"
                rows={4}
                value={draft.importAliasesText}
                spellCheck={false}
                onChange={(event) => updateDraft("importAliasesText", event.target.value)}
              />
              <em>格式：目标字段 | 别名1, 别名2。例：symbol | ISIN, Wind代码</em>
            </label>
            <label className="is-wide">
              <span>导入质检阈值</span>
              <textarea
                name="importQualityText"
                rows={4}
                value={draft.importQualityText}
                spellCheck={false}
                onChange={(event) => updateDraft("importQualityText", event.target.value)}
              />
              <div className="import-quality-presets" aria-label="导入质检阈值预设">
                {IMPORT_QUALITY_PRESETS.map((preset) => (
                  <button key={preset.key} type="button" onClick={() => applyImportQualityPreset(preset)}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <em>格式：阈值项 | 数字。例：top3Danger | 70</em>
            </label>
            <label className="is-wide is-template">
              <span>导入分析模板</span>
              <textarea
                name="importAnalysisText"
                rows={5}
                value={draft.importAnalysisText}
                spellCheck={false}
                onChange={(event) => updateDraft("importAnalysisText", event.target.value)}
              />
              <em>格式：模板项 | 文案。可用占位符：{"{state}"} {"{action}"} {"{condition}"} {"{fund}"} {"{topSymbol}"}</em>
            </label>
            <label className="is-wide">
              <span>约束条件</span>
              <textarea
                name="constraintsText"
                rows={3}
                value={draft.constraintsText}
                onChange={(event) => updateDraft("constraintsText", event.target.value)}
              />
              <em>格式：标签 | 条件 | tone</em>
            </label>
            <label className="is-portfolio">
              <span>持仓 / 观察符号</span>
              <textarea
                name="holdingsText"
                rows={7}
                value={draft.holdingsText}
                spellCheck={false}
                onChange={(event) => updateDraft("holdingsText", event.target.value)}
              />
              <em>格式：symbol | label | role | weight | sector | style | exposure | yahooSymbol</em>
            </label>
            <label className="is-rules">
              <span>规则 Builder</span>
              <textarea
                name="rulesText"
                rows={9}
                value={draft.rulesText}
                spellCheck={false}
                onChange={(event) => updateDraft("rulesText", event.target.value)}
              />
              <em>格式：dimension | label | factor | weight | type | symbol | points | reason | key=value;...</em>
            </label>
                </div>
                <div className="profile-builder-stats">
                  <span>{portfolioDraftStats.count} 个符号</span>
                  <span>权重 {portfolioDraftStats.totalWeight}%</span>
                  <span>{portfolioDraftStats.benchmarkStatus}</span>
                  <span>{ruleDraftStats.dimensions} 个维度</span>
                  <span>{ruleDraftStats.rules} 条规则</span>
                </div>
              </article>
            </div>
          </>
        ) : null}

        {activeSection === "generate" ? (
          <div className="profile-builder-layout">
            <article className="profile-builder-card profile-generate-card">
              <div className="profile-builder-head profile-generate-head">
                <div>
                  <span>生成与导入</span>
                  <strong>草稿生成后保存为 Profile</strong>
                </div>
                <em>只改草稿</em>
              </div>
              <div className="profile-generate-flow" aria-label="草稿转 Profile 流程">
                <div className={generateStepOneClass}>
                  <span>1</span>
                  <strong>生成草稿</strong>
                  <small>{draft.fundCode.trim() || fundSeed?.code || "基金代码 / Recipe"}</small>
                </div>
                <div className={generateStepTwoClass}>
                  <span>2</span>
                  <strong>校验草稿</strong>
                  <small>{generateValidationLabel}</small>
                </div>
                <div className={generateStepThreeClass}>
                  <span>3</span>
                  <strong>保存 Profile</strong>
                  <small>{draftSavedInList ? "已在 Profile 库" : "保存后出现在列表"}</small>
                </div>
              </div>
              <FundSeedGeneratorCard
                code={fundLookupCode}
                seed={fundSeed}
                status={fundLookupStatus}
                disabled={busy || fundLookupBusy}
                onCodeChange={setFundLookupCode}
                onLookup={() => void handleLookupFundSeed()}
                onApply={handleApplyFundSeed}
              />
              <section className="profile-generate-tools" aria-label="可选导入工具">
                <div className="profile-generate-tools-head">
                  <div>
                    <span>可选工具</span>
                    <strong>已有持仓或 AI Recipe</strong>
                  </div>
                  <em>辅助</em>
                </div>
                <div className="profile-builder-actions">
                  <Button startIcon={<FileUploadRoundedIcon />} onClick={() => holdingsInputRef.current?.click()} disabled={busy}>
                    持仓 JSON/CSV
                  </Button>
                  <Button startIcon={<FileUploadRoundedIcon />} onClick={() => recipeInputRef.current?.click()} disabled={busy}>
                    Recipe JSON
                  </Button>
                </div>
                <AiRecipeGeneratorCard
                  disabled={busy}
                  onCopyPrompt={() => void handleCopyRecipePrompt()}
                  onCopyExample={() => void handleCopyRecipeExample()}
                  onDownloadExample={handleDownloadRecipeExample}
                />
              </section>
              <input
                ref={holdingsInputRef}
                type="file"
                accept="application/json,text/csv,.json,.csv,.txt,.tsv"
                hidden
                onChange={(event) => void handleImportHoldings(event.target.files?.[0])}
              />
              <input
                ref={recipeInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void handleImportRecipe(event.target.files?.[0])}
              />
              {pendingRecipe ? (
                <AiRecipePreviewCard
                  pendingRecipe={pendingRecipe}
                  onApply={handleApplyRecipeImport}
                  onCancel={handleCancelRecipeImport}
                  disabled={busy}
                />
              ) : null}
              {pendingImport ? (
                <HoldingsImportPreviewCard
                  pendingImport={pendingImport}
                  onApply={handleApplyHoldingsImport}
                  onCancel={handleCancelHoldingsImport}
                  disabled={busy}
                />
              ) : null}
            </article>

            <article className="profile-config-copy">
              <span>当前草稿</span>
              <dl>
                <div>
                  <dt>Key</dt>
                  <dd>{draft.key}</dd>
                </div>
                <div>
                  <dt>基金</dt>
                  <dd>{draft.fundName || draft.name}</dd>
                </div>
                <div>
                  <dt>符号</dt>
                  <dd>{portfolioDraftStats.count} 个 / {portfolioDraftStats.totalWeight}%</dd>
                </div>
                <div>
                  <dt>规则</dt>
                  <dd>{ruleDraftStats.dimensions} 维 / {ruleDraftStats.rules} 条</dd>
                </div>
              </dl>
            </article>
          </div>
        ) : null}

        {activeSection === "profile" ? (
          <div className="profile-builder-layout">
            <div className="profile-config-side-stack">
              <article className="profile-builder-preview">
                <span>生成预览</span>
                <pre>{previewJson}</pre>
              </article>

              <article className="profile-config-copy">
                <span>可配置范围</span>
                <dl>
                  <div>
                    <dt>投资委托</dt>
                    <dd>mandate.objective / riskScoreLimit</dd>
                  </div>
                  <div>
                    <dt>基金画像</dt>
                    <dd>fund.code / holdingsAsOf / navSymbol</dd>
                  </div>
                  <div>
                    <dt>持仓权重</dt>
                    <dd>symbols[].weight / sector / style / exposure</dd>
                  </div>
                  <div>
                    <dt>规则证据</dt>
                    <dd>dimensions.rules.reason</dd>
                  </div>
                  <div>
                    <dt>状态文案</dt>
                    <dd>copy.states[state].summary / guidance</dd>
                  </div>
                  <div>
                    <dt>动作建议</dt>
                    <dd>copy.states[state].advice</dd>
                  </div>
                </dl>
              </article>
            </div>

            {validationReport ? (
              <ValidationCard report={validationReport} />
            ) : (
              <article className="profile-config-empty">
                <span>校验结果</span>
                <strong>还没有运行 Profile 校验</strong>
                <p>点击底部“校验草稿”后，这里会展示错误、警告和统计结果。</p>
                <div className="profile-config-empty-metrics" aria-label="当前草稿摘要">
                  <span>
                    <b>{portfolioDraftStats.count}</b>
                    符号
                  </span>
                  <span>
                    <b>{portfolioDraftStats.totalWeight}%</b>
                    权重
                  </span>
                  <span>
                    <b>{ruleDraftStats.rules}</b>
                    规则
                  </span>
                  <span>
                    <b>{draft.market.toUpperCase() || report.profileMarket.toUpperCase()}</b>
                    市场
                  </span>
                </div>
              </article>
            )}
          </div>
        ) : null}

        {showSubmitBar ? (
          <div className={`profile-builder-submit-bar is-${activeSection}`}>
            <div>
              <span>草稿到 Profile</span>
              <strong>{builderStatus}</strong>
            </div>
            <div className="profile-builder-submit-actions">
              <Button startIcon={<FactCheckRoundedIcon />} onClick={() => void handleValidateDraft()} disabled={busy}>
                校验草稿
              </Button>
              <Button startIcon={<SaveRoundedIcon />} onClick={() => void handleSaveDraft()} disabled={busy}>
                保存为 Profile
              </Button>
              <Button startIcon={<AddCircleRoundedIcon />} onClick={resetDraft} disabled={busy}>
                重置草稿
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FundSeedGeneratorCard({
  code,
  seed,
  status,
  disabled,
  onCodeChange,
  onLookup,
  onApply,
}: {
  code: string;
  seed: FundProfileSeed | null;
  status: string;
  disabled: boolean;
  onCodeChange: (value: string) => void;
  onLookup: () => void;
  onApply: () => void;
}) {
  const allocation = seed
    ? [
        seed.stockWeight == null ? null : `股 ${seed.stockWeight}%`,
        seed.bondWeight == null ? null : `债 ${seed.bondWeight}%`,
        seed.cashWeight == null ? null : `现 ${seed.cashWeight}%`,
      ].filter(Boolean).join(" / ")
    : "";

  return (
    <div className="fund-seed-generator">
      <div className="fund-seed-generator-head">
        <div>
          <span>公开资料生成</span>
          <strong>基金代码生成 Profile 草稿</strong>
        </div>
        <em>{seed ? seed.sourceName : "东方财富 / 天天基金"}</em>
      </div>
      <p className="fund-seed-source-note">
        支持 6 位公募基金代码；当前数据来自东方财富和天天基金公开接口，暂未接入支付宝基金专属接口。
      </p>
      <div className="fund-seed-search-row">
        <label>
          <span>基金代码</span>
          <input
            value={code}
            inputMode="numeric"
            maxLength={6}
            placeholder="输入 6 位基金代码"
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onLookup();
              }
            }}
          />
        </label>
        <Button startIcon={<ManageSearchRoundedIcon />} onClick={onLookup} disabled={disabled}>
          读取资料
        </Button>
      </div>
      {seed ? (
        <div className="fund-seed-result">
          <div>
            <strong>{seed.name}</strong>
            <span>{seed.code} · {seed.fundType || "基金"}{seed.manager ? ` · ${seed.manager}` : ""}</span>
          </div>
          <dl>
            <div>
              <dt>净值</dt>
              <dd>{seed.nav == null ? "-" : `${seed.nav}`}{seed.navDate ? ` · ${seed.navDate}` : ""}</dd>
            </div>
            <div>
              <dt>估值</dt>
              <dd>{seed.estimateChange == null ? "-" : `${seed.estimateChange}%`}{seed.estimateTime ? ` · ${seed.estimateTime}` : ""}</dd>
            </div>
            <div>
              <dt>近一年</dt>
              <dd>{seed.return1y == null ? "-" : `${seed.return1y}%`}</dd>
            </div>
            <div>
              <dt>资产配置</dt>
              <dd>{allocation || "未识别"}{seed.assetAllocationAsOf ? ` · ${seed.assetAllocationAsOf}` : ""}</dd>
            </div>
          </dl>
          {seed.topicLabels.length ? (
            <div className="fund-seed-tags">
              {seed.topicLabels.slice(0, 5).map((label) => <span key={label}>{label}</span>)}
            </div>
          ) : null}
          {seed.warnings.length ? <small>{seed.warnings.slice(0, 2).join("；")}</small> : null}
          <Button onClick={onApply} disabled={disabled}>应用为草稿</Button>
        </div>
      ) : null}
      <p className="fund-seed-status">{status}</p>
    </div>
  );
}

function AiRecipeGeneratorCard({
  disabled,
  onCopyPrompt,
  onCopyExample,
  onDownloadExample,
}: {
  disabled: boolean;
  onCopyPrompt: () => void;
  onCopyExample: () => void;
  onDownloadExample: () => void;
}) {
  return (
    <div className="ai-recipe-generator">
      <div>
        <span>AI Recipe</span>
        <strong>{AI_RECIPE_SCHEMA}</strong>
      </div>
      <div>
        <Button startIcon={<AutoAwesomeRoundedIcon />} onClick={onCopyPrompt} disabled={disabled}>
          复制提示词
        </Button>
        <Button startIcon={<ContentCopyRoundedIcon />} onClick={onCopyExample} disabled={disabled}>
          复制示例
        </Button>
        <Button startIcon={<DownloadRoundedIcon />} onClick={onDownloadExample} disabled={disabled}>
          下载示例
        </Button>
      </div>
    </div>
  );
}

function FundInfoCard({ fund, portfolioWeight }: { fund: ProfileFund | null; portfolioWeight: number }) {
  const tone = fund?.freshnessTone ?? "neutral";

  return (
    <article className={`profile-config-fund is-${tone}`}>
      <div>
        <span>基金层</span>
        <strong>{fund ? fund.name : "未启用 Fund Profile"}</strong>
        <em className={`is-${tone}`}>{fund ? fund.freshnessLabel : "可选"}</em>
      </div>
      <p>
        {fund
          ? fund.summary
          : "当前仍是通用市场/组合 Profile；配置 fund 后可记录基金代码、持仓披露日、净值 symbol 和持仓来源。"}
      </p>
      <dl>
        <div>
          <dt>代码</dt>
          <dd>{fund?.code || "-"}</dd>
        </div>
        <div>
          <dt>类型</dt>
          <dd>{fund?.fundType || "-"}</dd>
        </div>
        <div>
          <dt>净值</dt>
          <dd>{fund?.navSymbol || "未配置"}</dd>
        </div>
        <div>
          <dt>披露日</dt>
          <dd>{fund?.holdingsAsOf || "未配置"}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{fund?.holdingsSource || "手工维护"}</dd>
        </div>
        <div>
          <dt>穿透权重</dt>
          <dd>{portfolioWeight}%</dd>
        </div>
      </dl>
      {fund?.notes.length ? <small>{fund.notes[0]}</small> : null}
    </article>
  );
}

function AiRecipePreviewCard({
  pendingRecipe,
  onApply,
  onCancel,
  disabled,
}: {
  pendingRecipe: AiRecipeImport;
  onApply: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const visibleDiffs = pendingRecipe.diffs.slice(0, 8);

  return (
    <div className="ai-recipe-preview">
      <div className="ai-recipe-preview-head">
        <div>
          <strong>AI Recipe 预览</strong>
          <span>{pendingRecipe.sourceName} · {pendingRecipe.schema}</span>
        </div>
        <em>{pendingRecipe.intent || "fund_profile"}</em>
      </div>
      <div className="ai-recipe-diff-grid">
        {visibleDiffs.map((item) => (
          <article key={item.key} className={`is-${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.after || "清空"}</strong>
            <small>{item.before ? `原：${item.before}` : "新增配置"}</small>
          </article>
        ))}
      </div>
      <p>Recipe 只会应用到当前草稿；保存前仍需运行 Profile 校验。</p>
      {pendingRecipe.ignoredSections.length ? (
        <small>暂未编译：{pendingRecipe.ignoredSections.join(" / ")}</small>
      ) : null}
      {pendingRecipe.warnings.length ? (
        <small>{pendingRecipe.warnings.slice(0, 3).join("；")}</small>
      ) : null}
      <div>
        <Button onClick={onApply} disabled={disabled}>应用到草稿</Button>
        <Button onClick={onCancel} disabled={disabled}>放弃导入</Button>
      </div>
    </div>
  );
}

function HoldingsImportPreviewCard({
  pendingImport,
  onApply,
  onCancel,
  disabled,
}: {
  pendingImport: FundHoldingsImport;
  onApply: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const topHoldings = pendingImport.holdings.slice(0, 4);
  const fundFieldLabels = pendingImport.fundFields.length ? pendingImport.fundFields.join(" / ") : "未识别基金字段";
  const columnLabels = pendingImport.recognizedColumns.length ? pendingImport.recognizedColumns.slice(0, 8).join(" / ") : "未识别列";
  const aliasLabels = pendingImport.customAliasFields.length ? pendingImport.customAliasFields.join(" / ") : "默认映射";

  return (
    <div className="holdings-import-preview">
      <div className="holdings-import-preview-head">
        <div>
          <strong>持仓导入预览</strong>
          <span>{pendingImport.sourceName} · {pendingImport.sourceType.toUpperCase()}</span>
        </div>
        <em>{pendingImport.holdings.length} holdings</em>
      </div>
      <dl>
        <div>
          <dt>读取行</dt>
          <dd>{pendingImport.rowsRead}</dd>
        </div>
        <div>
          <dt>忽略行</dt>
          <dd>{pendingImport.ignoredRows}</dd>
        </div>
        <div>
          <dt>权重合计</dt>
          <dd>{pendingImport.totalWeight}%</dd>
        </div>
        <div>
          <dt>基金字段</dt>
          <dd>{fundFieldLabels}</dd>
        </div>
        <div>
          <dt>字段映射</dt>
          <dd>{aliasLabels}</dd>
        </div>
      </dl>
      <p>识别列：{columnLabels}</p>
      <div className="holdings-import-checks">
        <strong>导入预检</strong>
        <div>
          {pendingImport.diagnostics.map((item) => (
            <article key={item.key} className={`is-${item.tone}`}>
              <span>{item.label}</span>
              <em>{item.value}</em>
              <p>{item.message}</p>
            </article>
          ))}
        </div>
      </div>
      {pendingImport.analysis ? (
        <section className={`holdings-import-analysis is-${pendingImport.analysis.tone}`}>
          <div className="holdings-import-analysis-head">
            <span>基金分析摘要</span>
            <em>{pendingImport.analysis.label}</em>
            <strong>{pendingImport.analysis.headline}</strong>
          </div>
          <div className="holdings-import-analysis-grid">
            {pendingImport.analysis.items.map((item) => (
              <article key={item.key} className={`is-${item.tone}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <ul>
        {topHoldings.map((item) => (
          <li key={`${item.symbol}-${item.weight}`}>
            <strong>{item.symbol}</strong>
            <span>{item.label}</span>
            <em>{item.weight}%</em>
          </li>
        ))}
      </ul>
      {pendingImport.warnings.length ? (
        <small>{pendingImport.warnings.slice(0, 2).join("；")}</small>
      ) : null}
      <div>
        <Button onClick={onApply} disabled={disabled}>应用到草稿</Button>
        <Button onClick={onCancel} disabled={disabled}>放弃导入</Button>
      </div>
    </div>
  );
}

function ValidationCard({ report }: { report: ProfileValidationReport }) {
  const tone = report.valid ? (report.warnings.length ? "caution" : "positive") : "negative";
  const issues = [...report.errors, ...report.warnings].slice(0, 5);

  return (
    <div className={`profile-validation-card is-${tone}`}>
      <div>
        <strong>{report.valid ? "校验通过" : "校验失败"}</strong>
        <span>{report.summary}</span>
      </div>
      <dl>
        <div>
          <dt>Symbols</dt>
          <dd>{report.stats.symbols}</dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>{report.stats.rules}</dd>
        </div>
        <div>
          <dt>权重</dt>
          <dd>{report.stats.totalWeight}%</dd>
        </div>
        <div>
          <dt>维度</dt>
          <dd>{report.stats.dimensionWeight}</dd>
        </div>
      </dl>
      {issues.length ? (
        <ul>
          {issues.map((issue) => (
            <li key={`${issue.severity}-${issue.path}-${issue.message}`}>
              <em>{issue.path}</em>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type JsonObject = Record<string, unknown>;

const DRAFT_FIELDS: (keyof ProfileDraft)[] = [
  "key",
  "name",
  "market",
  "description",
  "benchmarkSymbol",
  "fundCode",
  "fundName",
  "fundType",
  "fundManager",
  "fundIssuer",
  "fundNavSymbol",
  "fundHoldingsAsOf",
  "fundHoldingsSource",
  "fundNotesText",
  "importAliasesText",
  "importQualityText",
  "importAnalysisText",
  "objective",
  "benchmarkName",
  "timeHorizon",
  "riskBudget",
  "maxDrawdown",
  "targetGrossExposure",
  "riskScoreLimit",
  "constraintsText",
  "notesText",
  "holdingsText",
  "rulesText",
];

function draftFromForm(draft: ProfileDraft, root: HTMLDivElement | null): ProfileDraft {
  if (!root) return draft;
  const next = { ...draft };
  for (const field of DRAFT_FIELDS) {
    const control = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${field}"]`);
    if (control) {
      next[field] = control.value;
    }
  }
  return next;
}

function buildDraft(current: ProfileSummary | undefined, report: MarketAnalysisReport, profile: string): ProfileDraft {
  const key = current?.builtin ? `${current.key}-custom` : current?.key ?? `${profile}-custom`;
  const mandate = report.profileMandate;
  const fund = report.profileFund;

  return {
    key,
    name: current?.builtin ? `${current.name} 自定义` : current?.name ?? `${report.profileName} 自定义`,
    market: current?.market ?? report.profileMarket,
    description: current?.description || report.profileName,
    benchmarkSymbol: report.backtest.benchmarkSymbol,
    fundCode: fund?.code ?? "",
    fundName: fund?.name ?? "",
    fundType: fund?.fundType ?? "",
    fundManager: fund?.manager === "未设置" ? "" : fund?.manager ?? "",
    fundIssuer: fund?.issuer === "未设置" ? "" : fund?.issuer ?? "",
    fundNavSymbol: fund?.navSymbol ?? "",
    fundHoldingsAsOf: fund?.holdingsAsOf ?? "",
    fundHoldingsSource: fund?.holdingsSource ?? "",
    fundNotesText: fund?.notes.join("\n") ?? "",
    importAliasesText: "",
    importQualityText: "",
    importAnalysisText: "",
    objective: mandate.objective,
    benchmarkName: mandate.benchmarkName,
    timeHorizon: mandate.timeHorizon,
    riskBudget: mandate.riskBudget,
    maxDrawdown: mandate.maxDrawdown,
    targetGrossExposure: mandate.targetGrossExposure,
    riskScoreLimit: mandate.riskScoreLimit == null ? "" : String(mandate.riskScoreLimit),
    constraintsText: constraintsToText(mandate.constraints),
    notesText: mandate.notes.join("\n"),
    holdingsText: holdingsToText(report),
    rulesText: "",
  };
}

function buildDraftFromProfileConfig(
  config: JsonObject,
  current: ProfileSummary | undefined,
  report: MarketAnalysisReport,
  profile: string,
): ProfileDraft {
  const mandate = asObject(config.mandate);
  const fund = asObject(config.fund);
  const fallback = buildDraft(current, report, profile);
  const configKey = textFrom(config.key, current?.key ?? profile);
  const configName = textFrom(config.name, current?.name ?? report.profileName);
  const configMarket = textFrom(config.market, current?.market ?? report.profileMarket);

  return {
    ...fallback,
    key: current?.builtin ? `${configKey}-custom` : configKey,
    name: current?.builtin ? `${configName} 自定义` : configName,
    market: configMarket,
    description: textFrom(config.description, current?.description || fallback.description),
    benchmarkSymbol: textFrom(config.benchmark, fallback.benchmarkSymbol),
    fundCode: textFrom(fund.code, fallback.fundCode),
    fundName: textFrom(fund.name, fallback.fundName),
    fundType: textFrom(fund.fundType, fallback.fundType),
    fundManager: textFrom(fund.manager, fallback.fundManager),
    fundIssuer: textFrom(fund.issuer, fallback.fundIssuer),
    fundNavSymbol: textFrom(fund.navSymbol, fallback.fundNavSymbol),
    fundHoldingsAsOf: textFrom(fund.holdingsAsOf, fallback.fundHoldingsAsOf),
    fundHoldingsSource: textFrom(fund.holdingsSource, fallback.fundHoldingsSource),
    fundNotesText: textListFrom(fund.notes, fallback.fundNotesText),
    objective: textFrom(mandate.objective, fallback.objective),
    benchmarkName: textFrom(mandate.benchmarkName, fallback.benchmarkName),
    timeHorizon: textFrom(mandate.timeHorizon, fallback.timeHorizon),
    riskBudget: textFrom(mandate.riskBudget, fallback.riskBudget),
    maxDrawdown: textFrom(mandate.maxDrawdown, fallback.maxDrawdown),
    targetGrossExposure: textFrom(mandate.targetGrossExposure, fallback.targetGrossExposure),
    riskScoreLimit: textFromAny(mandate.riskScoreLimit) || fallback.riskScoreLimit,
    constraintsText: constraintsFromProfileConfig(mandate.constraints, fallback.constraintsText),
    notesText: textListFrom(mandate.notes, fallback.notesText),
    holdingsText: symbolsToText(config.symbols, fallback.holdingsText),
    rulesText: dimensionsToText(config.dimensions),
  };
}

function constraintsFromProfileConfig(value: unknown, fallback: string) {
  if (!Array.isArray(value) || !value.length) return fallback;
  return value
    .map((item) => {
      const constraint = asObject(item);
      return [
        textFrom(constraint.label, textFrom(constraint.key, "")),
        textFromAny(constraint.value),
        textFrom(constraint.tone, "neutral"),
      ].join(" | ");
    })
    .join("\n");
}

function textListFrom(value: unknown, fallback: string) {
  if (Array.isArray(value)) {
    return value.map((item) => textFromAny(item)).filter(Boolean).join("\n");
  }
  return textFrom(value, fallback);
}

function applyFundSeedToDraft(
  draft: ProfileDraft,
  seed: FundProfileSeed,
  profiles: ProfileSummary[],
): ProfileDraft {
  const baseKey = uniqueProfileKey(`cn-fund-${seed.code}`, profiles);
  const topicText = seed.topicLabels.length ? seed.topicLabels.join(" / ") : "公开资料";
  const stockExposure = seed.stockWeight == null ? "" : `股票仓位 ${seed.stockWeight}%`;
  const latestPosition = seed.latestStockPosition == null ? "" : `仓位测算 ${seed.latestStockPosition}%`;
  const navText = seed.nav == null ? "" : `最新净值 ${seed.nav}${seed.navDate ? `（${seed.navDate}）` : ""}`;
  const estimateText = seed.estimateChange == null ? "" : `估值变化 ${seed.estimateChange}%${seed.estimateTime ? `（${seed.estimateTime}）` : ""}`;
  const returnText = [
    seed.return1m == null ? null : `近1月 ${seed.return1m}%`,
    seed.return3m == null ? null : `近3月 ${seed.return3m}%`,
    seed.return6m == null ? null : `近6月 ${seed.return6m}%`,
    seed.return1y == null ? null : `近1年 ${seed.return1y}%`,
  ].filter(Boolean).join(" / ");
  const sourceNote = `公开资料源：${seed.sourceName}；${seed.sourceUrl}`;
  const warningNote = seed.warnings.length ? `数据提示：${seed.warnings.join("；")}` : "";
  const sourceLines = [
    navText,
    estimateText,
    returnText,
    stockExposure || latestPosition ? [stockExposure, latestPosition].filter(Boolean).join("；") : "",
    sourceNote,
    warningNote,
  ].filter(Boolean);
  return {
    ...draft,
    key: baseKey,
    name: `${seed.name} Profile`,
    market: "cn",
    description: `${seed.name}（${seed.code}）${seed.fundType ? ` · ${seed.fundType}` : ""}，基于公开资料生成的基金观察模板。`,
    benchmarkSymbol: "CSI300",
    benchmarkName: "沪深300 / 原基金业绩比较基准需人工核对",
    fundCode: seed.code,
    fundName: seed.name,
    fundType: normalizeFundType(seed.fundType),
    fundManager: seed.manager,
    fundIssuer: seed.issuer,
    fundNavSymbol: seed.navSymbol,
    fundHoldingsAsOf: seed.assetAllocationAsOf ?? seed.navDate ?? "",
    fundHoldingsSource: `${seed.sourceName} · ${seed.fetchedAt.slice(0, 10)}`,
    fundNotesText: sourceLines.join("\n"),
    objective: `围绕 ${seed.name} 的公开净值、主题暴露和 A 股核心风险信号做轻量监控。目标不是预测净值，而是在趋势、系统压力和主题拥挤度同时确认前，避免追高加仓。`,
    riskBudget: fundRiskBudget(seed),
    timeHorizon: "3-12 个月状态跟踪，短线只作为加减仓触发参考。",
    maxDrawdown: seed.fundType.includes("债") ? "5%-12%" : "12%-25%",
    targetGrossExposure: seed.stockWeight == null ? "按基金原始仓位观察，不自动推导加仓比例。" : `${Math.round(seed.stockWeight)}% 附近，以公开披露/估算仓位为参考。`,
    riskScoreLimit: seed.fundType.includes("债") ? "55" : "65",
    constraintsText: fundSeedConstraints(seed),
    notesText: [
      `主题标签：${topicText}`,
      "公开基金资料可能滞后，持仓穿透需结合季报或手工导入文件确认。",
      "短期、中期、长期仓位建议仍由当前市场状态和规则触发共同决定。",
      sourceNote,
    ].join("\n"),
    holdingsText: fundSeedHoldingsText(seed),
    rulesText: fundSeedRulesText(seed),
    importAliasesText: draft.importAliasesText || defaultRecipeImportAliasesText(),
    importQualityText: draft.importQualityText || importQualityPresetToText(IMPORT_QUALITY_PRESETS[0]),
    importAnalysisText: draft.importAnalysisText || defaultRecipeImportAnalysisText(seed.name),
  };
}

function uniqueProfileKey(baseKey: string, profiles: ProfileSummary[]) {
  const existing = new Set(profiles.map((item) => item.key));
  if (!existing.has(baseKey)) return baseKey;
  for (let index = 2; index < 100; index += 1) {
    const next = `${baseKey}-${index}`;
    if (!existing.has(next)) return next;
  }
  return `${baseKey}-${Date.now().toString(36)}`;
}

function normalizeFundType(value: string) {
  const text = value.trim();
  if (/债|货币/u.test(text)) return text || "fixed_income";
  if (/指数|ETF|联接/u.test(text)) return text || "index_fund";
  if (/QDII|海外|全球|港股|美股/u.test(text)) return text || "qdii";
  if (/混合/u.test(text)) return text || "balanced";
  return text || "active_equity";
}

function fundRiskBudget(seed: FundProfileSeed) {
  const stockWeight = seed.stockWeight ?? seed.latestStockPosition;
  if (seed.fundType.includes("债")) {
    return "以回撤控制和久期/信用风险为主，风险升高时先降低新增申购节奏。";
  }
  if (stockWeight != null && stockWeight >= 85) {
    return "高股票仓位基金，新增申购需要同时满足基准趋势修复、主题不过热和系统压力下降。";
  }
  return "按 Trend / Risk / Edge 管控新增仓位，公开资料只做基金画像，不替代真实持仓确认。";
}

function fundSeedConstraints(seed: FundProfileSeed) {
  const constraints = [
    "公开资料滞后 | 季报和估算仓位可能滞后，保存前核对最新披露 | caution",
    "不追高 | 主题过热或基准跌破 MA20 时不新增追高 | caution",
    "风险优先 | 系统压力高于风险上限时先控制新增申购 | negative",
  ];
  if ((seed.stockWeight ?? 0) >= 85) {
    constraints.push("高仓位 | 股票仓位较高，回撤期优先等待趋势修复 | caution");
  }
  return constraints.join("\n");
}

function fundSeedHoldingsText(seed: FundProfileSeed) {
  const sector = fundSeedSectorSymbol(seed);
  const rows: SymbolDraft[] = sector
    ? [
        { symbol: "CSI300", label: "沪深300ETF", role: "benchmark", weight: 35, sector: "宽基", style: "核心", exposure: "A股", yahooSymbol: "510300.SS" },
        { ...sector, weight: 20 },
        { symbol: "SSE50", label: "上证50ETF", role: "large_cap", weight: 12, sector: "大盘蓝筹", style: "价值", exposure: "A股", yahooSymbol: "510050.SS" },
        { symbol: "CHINEXT", label: "创业板ETF", role: "growth", weight: 12, sector: "成长", style: "成长", exposure: "A股", yahooSymbol: "159915.SZ" },
        { symbol: "STAR50", label: "科创50ETF", role: "growth", weight: 8, sector: "科技", style: "成长", exposure: "A股", yahooSymbol: "588000.SS" },
        { symbol: "CSI1000", label: "中证1000ETF", role: "breadth", weight: 8, sector: "小盘", style: "风险偏好", exposure: "A股", yahooSymbol: "159845.SZ" },
        { symbol: "ASHR", label: "海外A股ETF", role: "offshore", weight: 5, sector: "离岸A股", style: "外资", exposure: "离岸", yahooSymbol: "ASHR" },
      ]
    : [
        { symbol: "CSI300", label: "沪深300ETF", role: "benchmark", weight: 35, sector: "宽基", style: "核心", exposure: "A股", yahooSymbol: "510300.SS" },
        { symbol: "SSE50", label: "上证50ETF", role: "large_cap", weight: 20, sector: "大盘蓝筹", style: "价值", exposure: "A股", yahooSymbol: "510050.SS" },
        { symbol: "CHINEXT", label: "创业板ETF", role: "growth", weight: 18, sector: "成长", style: "成长", exposure: "A股", yahooSymbol: "159915.SZ" },
        { symbol: "STAR50", label: "科创50ETF", role: "growth", weight: 12, sector: "科技", style: "成长", exposure: "A股", yahooSymbol: "588000.SS" },
        { symbol: "CSI1000", label: "中证1000ETF", role: "breadth", weight: 10, sector: "小盘", style: "风险偏好", exposure: "A股", yahooSymbol: "159845.SZ" },
        { symbol: "ASHR", label: "海外A股ETF", role: "offshore", weight: 5, sector: "离岸A股", style: "外资", exposure: "离岸", yahooSymbol: "ASHR" },
      ];
  return holdingsDraftsToText(rows);
}

function fundSeedSectorSymbol(seed: FundProfileSeed): SymbolDraft | null {
  const text = `${seed.name} ${seed.topicLabels.join(" ")}`;
  if (/消费|食品|饮料/u.test(text)) {
    return { symbol: "CONSUMPTION", label: "消费ETF", role: "theme", weight: 0, sector: "消费", style: "主题", exposure: "A股", yahooSymbol: "159928.SZ" };
  }
  if (/医药|医疗|生物/u.test(text)) {
    return { symbol: "HEALTHCARE", label: "医药ETF", role: "theme", weight: 0, sector: "医药", style: "防御成长", exposure: "A股", yahooSymbol: "512010.SS" };
  }
  if (/半导体|芯片|集成电路/u.test(text)) {
    return { symbol: "SEMICONDUCTOR_CN", label: "半导体ETF", role: "theme", weight: 0, sector: "半导体", style: "成长", exposure: "A股", yahooSymbol: "512480.SS" };
  }
  if (/新能源|电池|光伏|车/u.test(text)) {
    return { symbol: "NEWENERGY", label: "新能源车ETF", role: "theme", weight: 0, sector: "新能源", style: "成长", exposure: "A股", yahooSymbol: "515030.SS" };
  }
  return null;
}

function fundSeedRulesText(seed: FundProfileSeed) {
  const theme = fundSeedSectorSymbol(seed);
  const themeSymbol = theme?.symbol ?? "CHINEXT";
  const themeLabel = theme?.label ?? "成长风格";
  return [
    `fund_trend | 基金基准趋势 | trend | 35 | close_below_ma | CSI300 | 8 | 沪深300 跌破 MA20，${seed.name} 新增申购需要等待修复 | period=20`,
    `fund_trend | 基金基准趋势 | trend | 35 | close_below_ma | CSI300 | 12 | 沪深300 跌破 MA50，中期趋势承压 | period=50`,
    `theme_heat | 主题拥挤 | heat | 25 | rsi_above | ${themeSymbol} | 9 | ${themeLabel} RSI {rsi}，主题短线过热 | period=14;threshold=75`,
    `theme_heat | 主题拥挤 | heat | 25 | return_above | ${themeSymbol} | 8 | ${themeLabel} 20 日涨幅过快，新增追高赔率下降 | days=20;threshold=18`,
    "market_breadth | 市场宽度 | structure | 20 | relative_strength_declined | CSI1000 | 8 | 中证1000 相对沪深300 连续走弱，风险偏好收缩 | other=CSI300;days=5",
    "systemic_guard | 系统压力 | systemic | 20 | close_below_ma | ASHR | 7 | 海外A股ETF 跌破 MA50，外部确认不足 | period=50",
  ].join("\n");
}

function defaultRecipeImportAliasesText() {
  return [
    "symbol | symbol, ticker, code, 证券代码, 股票代码, 代码",
    "label | label, name, 证券名称, 股票名称, 名称",
    "weight | weight, weightPct, 持仓比例, 占净值比例, 权重",
    "sector | sector, industry, 行业, 板块",
    "fundCode | fundCode, 基金代码, 产品代码",
    "fundName | fundName, 基金名称, 产品名称",
    "fundHoldingsAsOf | holdingsAsOf, 披露日期, 持仓披露日, 报告期",
  ].join("\n");
}

function defaultRecipeImportAnalysisText(fundName: string) {
  return [
    `headlineCaution | ${fundName} 只生成公开资料草稿，买点仍需等待 {conditionLabel}。`,
    `headlinePositive | ${fundName} 的公开资料与当前状态可继续观察，但保存前需核对持仓。`,
    `headlineNegative | ${fundName} 公开资料或市场状态不支持新增动作。`,
    "shortCaution | {fund} 短线只做观察，等待 {condition}。",
    "shortPositive | {fund} 可小仓试探，但不替代真实持仓确认。",
    "shortNegative | {fund} 当前不适合新增，优先处理 {issueMessage}。",
    "longCaution | 长线配置需要核对季报持仓和主题集中度。",
    "longPositive | 长线可纳入观察池，回撤和风险预算仍按 Profile 触发。",
    "longNegative | 先补齐持仓披露和基准规则，再考虑配置。",
  ].join("\n");
}

function buildDraftPreview(draft: ProfileDraft, report: MarketAnalysisReport, base: JsonObject | null) {
  return {
    key: draft.key.trim(),
    name: draft.name.trim(),
    market: draft.market.trim(),
    description: draft.description.trim(),
    benchmark: normalizeSymbol(draft.benchmarkSymbol || report.backtest.benchmarkSymbol),
    fund: buildFundObject(draft, asObject(base?.fund)),
    mandate: {
      objective: draft.objective.trim(),
      benchmarkName: draft.benchmarkName.trim(),
      timeHorizon: draft.timeHorizon.trim(),
      riskBudget: draft.riskBudget.trim(),
      maxDrawdown: draft.maxDrawdown.trim(),
      targetGrossExposure: draft.targetGrossExposure.trim(),
      riskScoreLimit: parseRiskLimit(draft.riskScoreLimit),
      constraints: parseConstraintLines(draft.constraintsText),
      notes: parseLines(draft.notesText),
    },
    symbols: parseHoldingLines(draft.holdingsText).map((item) => ({
      symbol: item.symbol,
      label: item.label,
      role: item.role,
      weight: item.weight,
      sector: item.sector,
      style: item.style,
      exposure: item.exposure,
      yahooSymbol: item.yahooSymbol,
    })),
    dimensions: mergeProfileDimensions(base?.dimensions, parseRuleLines(draft.rulesText)),
  };
}

function buildFundObject(draft: ProfileDraft, baseFund: JsonObject): JsonObject | undefined {
  const next: JsonObject = {
    ...baseFund,
    code: draft.fundCode.trim(),
    name: draft.fundName.trim(),
    fundType: draft.fundType.trim(),
    manager: draft.fundManager.trim(),
    issuer: draft.fundIssuer.trim(),
    navSymbol: normalizeSymbol(draft.fundNavSymbol),
    holdingsAsOf: draft.fundHoldingsAsOf.trim(),
    holdingsSource: draft.fundHoldingsSource.trim(),
    notes: parseLines(draft.fundNotesText),
    importAliases: parseImportAliasLines(draft.importAliasesText),
    importQuality: parseImportQualityLines(draft.importQualityText),
    importAnalysis: parseImportAnalysisTemplateLines(draft.importAnalysisText),
  };
  const hasFundIdentity = Object.entries(next).some(([key, value]) => {
    if (key === "notes") return Array.isArray(value) && value.length > 0;
    if (key === "importAliases") return Object.keys(asObject(value)).length > 0;
    if (key === "importQuality") return Object.keys(asObject(value)).length > 0;
    if (key === "importAnalysis") return Object.keys(asObject(value)).length > 0;
    return typeof value === "string" ? value.trim().length > 0 : value != null;
  });
  if (!hasFundIdentity) return undefined;
  return Object.fromEntries(Object.entries(next).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(asObject(value)).length > 0;
    return value !== "";
  }));
}

function applyDraftToProfile(base: JsonObject, draft: ProfileDraft, report: MarketAnalysisReport): JsonObject {
  const mandate = asObject(base.mandate);
  const nextMandate: JsonObject = {
    ...mandate,
    mandateType: textFrom(mandate.mandateType, "主动风险监控"),
    baseCurrency: textFrom(mandate.baseCurrency, defaultCurrency(draft.market || report.profileMarket)),
    benchmarkName: draft.benchmarkName.trim(),
    objective: draft.objective.trim(),
    timeHorizon: draft.timeHorizon.trim(),
    riskBudget: draft.riskBudget.trim(),
    maxDrawdown: draft.maxDrawdown.trim(),
    targetGrossExposure: draft.targetGrossExposure.trim(),
    rebalanceCadence: textFrom(mandate.rebalanceCadence, "日度评分，触发式调整"),
    liquidity: textFrom(mandate.liquidity, "ETF 与高流动性核心资产优先"),
    riskScoreLimit: parseRiskLimit(draft.riskScoreLimit),
    constraints: parseConstraintLines(draft.constraintsText),
    notes: parseLines(draft.notesText),
  };

  return {
    ...base,
    key: draft.key.trim(),
    name: draft.name.trim(),
    market: draft.market.trim(),
    benchmark: normalizeSymbol(draft.benchmarkSymbol || report.backtest.benchmarkSymbol),
    description: draft.description.trim(),
    fund: buildFundObject(draft, asObject(base.fund)),
    symbols: mergeProfileSymbols(base.symbols, parseHoldingLines(draft.holdingsText)),
    dimensions: mergeProfileDimensions(base.dimensions, parseRuleLines(draft.rulesText)),
    mandate: nextMandate,
  };
}

function validateDraft(draft: ProfileDraft, profiles: ProfileSummary[]) {
  const key = draft.key.trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,58}$/.test(key)) {
    return "Key 仅支持小写字母、数字、短横线和下划线，并且至少 2 个字符。";
  }
  if (!draft.name.trim()) {
    return "名称不能为空。";
  }
  if (!draft.market.trim()) {
    return "市场不能为空。";
  }
  if (!draft.benchmarkSymbol.trim()) {
    return "基准代码不能为空。";
  }
  if (!draft.objective.trim()) {
    return "投资目标不能为空。";
  }
  const riskLimit = parseRiskLimit(draft.riskScoreLimit);
  if (draft.riskScoreLimit.trim() && riskLimit == null) {
    return "风险上限需要是 0-100 之间的数字。";
  }
  if (draft.fundHoldingsAsOf.trim() && !isIsoDate(draft.fundHoldingsAsOf.trim())) {
    return "持仓披露日需要使用 YYYY-MM-DD。";
  }
  const aliasValidation = validateImportAliasText(draft.importAliasesText);
  if (aliasValidation) {
    return aliasValidation;
  }
  const qualityValidation = validateImportQualityText(draft.importQualityText);
  if (qualityValidation) {
    return qualityValidation;
  }
  const analysisValidation = validateImportAnalysisTemplateText(draft.importAnalysisText);
  if (analysisValidation) {
    return analysisValidation;
  }
  if (profiles.some((item) => item.key === key && item.builtin)) {
    return "不能覆盖内置 Profile，请换一个自定义 key。";
  }
  const symbols = parseHoldingLines(draft.holdingsText);
  if (!symbols.length) {
    return "至少需要一个持仓或观察符号。";
  }
  const symbolSet = new Set<string>();
  for (const item of symbols) {
    if (!item.symbol) {
      return "持仓行缺少 symbol。";
    }
    if (!Number.isFinite(item.weight) || item.weight < 0) {
      return `${item.symbol} 的 weight 需要是大于等于 0 的数字。`;
    }
    if (symbolSet.has(item.symbol)) {
      return `${item.symbol} 重复出现，请合并为一行。`;
    }
    symbolSet.add(item.symbol);
  }
  const benchmark = normalizeSymbol(draft.benchmarkSymbol);
  if (!symbolSet.has(benchmark)) {
    return `基准代码 ${benchmark} 必须出现在持仓 / 观察符号中。`;
  }
  const ruleValidation = validateRulesText(draft.rulesText);
  if (ruleValidation) {
    return ruleValidation;
  }
  return "";
}

function localValidationReport(message: string): ProfileValidationReport {
  return {
    valid: false,
    summary: "本地格式校验失败：1 个错误。",
    errors: [
      {
        severity: "error",
        scope: "builder",
        path: "profile-builder",
        message,
      },
    ],
    warnings: [],
    stats: {
      symbols: 0,
      weightedSymbols: 0,
      totalWeight: 0,
      dimensions: 0,
      dimensionWeight: 0,
      rules: 0,
    },
  };
}

function parseRiskLimit(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null;
  }
  return Math.round(numeric);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function parseLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseConstraintLines(value: string): MandateConstraint[] {
  return value
    .split("\n")
    .map((line, index) => {
      const [label, condition, tone = "neutral"] = line.split("|").map((part) => part.trim());
      if (!label || !condition) return null;
      return {
        key: slugify(label) || `constraint_${index + 1}`,
        label,
        value: condition,
        tone,
      };
    })
    .filter((item): item is MandateConstraint => Boolean(item));
}

function constraintsToText(items: MandateConstraint[]) {
  return items.map((item) => `${item.label} | ${item.value} | ${item.tone}`).join("\n");
}

function holdingsToText(report: MarketAnalysisReport) {
  const holdingBySymbol = new Map(report.portfolioProfile.holdings.map((item) => [item.symbol, item]));
  return report.assetStatuses
    .map((asset) => {
      const holding = holdingBySymbol.get(asset.symbol);
      const role = asset.symbol === report.backtest.benchmarkSymbol ? "benchmark" : isVolatilitySymbol(asset.symbol) ? "volatility" : "";
      return [
        asset.symbol,
        asset.label,
        role,
        holding?.weight ?? 0,
        holding?.sector ?? (isVolatilitySymbol(asset.symbol) ? "波动率" : "观察"),
        holding?.style ?? (isVolatilitySymbol(asset.symbol) ? "对冲" : "观察"),
        holding?.exposure ?? (isVolatilitySymbol(asset.symbol) ? "观察" : report.profileMarket.toUpperCase()),
        asset.symbol === "VIX" ? "^VIX" : asset.symbol,
      ].join(" | ");
    })
    .join("\n");
}

function symbolsToText(value: unknown, fallback: string) {
  if (!Array.isArray(value) || !value.length) return fallback;
  return value
    .map((item) => {
      const symbol = asObject(item);
      return [
        textFrom(symbol.symbol, ""),
        textFrom(symbol.label, textFrom(symbol.symbol, "")),
        textFrom(symbol.role, ""),
        numberFrom(symbol.weight, 0),
        textFrom(symbol.sector, ""),
        textFrom(symbol.style, ""),
        textFrom(symbol.exposure, ""),
        textFrom(symbol.yahooSymbol, textFrom(symbol.symbol, "")),
      ].join(" | ");
    })
    .join("\n");
}

function parseHoldingLines(value: string): SymbolDraft[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [symbol = "", label = "", role = "", weight = "0", sector = "", style = "", exposure = "", yahooSymbol = ""] = line
        .split("|")
        .map((part) => part.trim());
      const normalized = normalizeSymbol(symbol);
      return {
        symbol: normalized,
        label: label || normalized,
        role,
        weight: Number(weight),
        sector,
        style,
        exposure,
        yahooSymbol: yahooSymbol || normalized,
      };
    });
}

type ImportAliasConfig = Record<string, string[]>;

type ImportAliasGroup = {
  key: string;
  label: string;
  targets: string[];
  aliases: string[];
};

const IMPORT_ALIAS_GROUPS: ImportAliasGroup[] = [
  {
    key: "symbol",
    label: "代码",
    targets: ["symbol", "代码", "证券代码", "股票代码", "持仓代码"],
    aliases: ["symbol", "ticker", "code", "holdingCode", "assetCode", "windCode", "证券代码", "股票代码", "代码"],
  },
  {
    key: "label",
    label: "名称",
    targets: ["label", "name", "名称", "证券名称", "股票名称"],
    aliases: ["label", "name", "holdingName", "securityName", "证券名称", "股票名称", "名称"],
  },
  {
    key: "role",
    label: "角色",
    targets: ["role", "角色"],
    aliases: ["role", "角色"],
  },
  {
    key: "weight",
    label: "权重",
    targets: ["weight", "权重", "持仓比例"],
    aliases: ["weight", "weightPct", "weightPercent", "percent", "ratio", "持仓比例", "占净值比例", "净值占比", "比例", "权重"],
  },
  {
    key: "sector",
    label: "行业",
    targets: ["sector", "industry", "行业", "板块"],
    aliases: ["sector", "industry", "行业", "板块"],
  },
  {
    key: "style",
    label: "风格",
    targets: ["style", "factor", "风格"],
    aliases: ["style", "factor", "风格"],
  },
  {
    key: "exposure",
    label: "市场",
    targets: ["exposure", "market", "region", "市场", "地区", "暴露"],
    aliases: ["exposure", "market", "region", "市场", "地区", "暴露"],
  },
  {
    key: "yahooSymbol",
    label: "行情代码",
    targets: ["yahooSymbol", "yahoo", "行情代码", "雅虎代码"],
    aliases: ["yahooSymbol", "yahoo", "行情代码", "雅虎代码"],
  },
  {
    key: "fundCode",
    label: "基金代码",
    targets: ["fundCode", "基金代码", "产品代码"],
    aliases: ["fundCode", "fund_code", "基金代码", "产品代码"],
  },
  {
    key: "fundName",
    label: "基金名称",
    targets: ["fundName", "基金名称", "产品名称"],
    aliases: ["fundName", "fund_name", "基金名称", "产品名称"],
  },
  {
    key: "fundType",
    label: "基金类型",
    targets: ["fundType", "基金类型", "产品类型"],
    aliases: ["fundType", "type", "基金类型", "产品类型"],
  },
  {
    key: "fundManager",
    label: "基金经理",
    targets: ["fundManager", "manager", "基金经理"],
    aliases: ["manager", "fundManager", "基金经理"],
  },
  {
    key: "fundIssuer",
    label: "管理人",
    targets: ["fundIssuer", "issuer", "管理人", "基金公司"],
    aliases: ["issuer", "company", "fundIssuer", "管理人", "基金公司"],
  },
  {
    key: "fundNavSymbol",
    label: "净值代码",
    targets: ["fundNavSymbol", "navSymbol", "净值代码"],
    aliases: ["navSymbol", "fundNavSymbol", "净值代码"],
  },
  {
    key: "fundHoldingsAsOf",
    label: "披露日",
    targets: ["fundHoldingsAsOf", "holdingsAsOf", "披露日", "持仓披露日", "报告期"],
    aliases: ["holdingsAsOf", "asOf", "fundHoldingsAsOf", "披露日期", "持仓披露日", "报告期"],
  },
  {
    key: "fundHoldingsSource",
    label: "来源",
    targets: ["fundHoldingsSource", "holdingsSource", "来源", "持仓来源"],
    aliases: ["holdingsSource", "fundHoldingsSource", "来源", "持仓来源"],
  },
];

const HOLDING_IMPORT_ALIAS_KEYS = ["symbol", "label", "role", "weight", "sector", "style", "exposure", "yahooSymbol"];

function parseImportAliasLines(value: string): ImportAliasConfig {
  const config: ImportAliasConfig = {};
  for (const [index, rawLine] of value.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const [target = "", aliasText = ""] = line.split("|").map((part) => part.trim());
    const group = importAliasGroupFor(target);
    if (!group || !aliasText) continue;
    const aliases = aliasText
      .split(/[,，;；]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!aliases.length) continue;
    config[group.key] = uniqueStrings([...(config[group.key] ?? []), ...aliases]);
    if (index > 100) break;
  }
  return config;
}

function validateImportAliasText(value: string) {
  for (const [index, rawLine] of value.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return `字段映射第 ${index + 1} 行需要使用：目标字段 | 别名1, 别名2。`;
    }
    if (!importAliasGroupFor(parts[0])) {
      return `字段映射第 ${index + 1} 行的目标字段 ${parts[0]} 不支持。`;
    }
  }
  return "";
}

function importAliasesToText(value: unknown, fallback: string) {
  const aliases = asObject(value);
  if (!Object.keys(aliases).length) return fallback;
  return IMPORT_ALIAS_GROUPS
    .map((group) => {
      const values = aliasListFromUnknown(aliases[group.key]);
      return values.length ? `${group.key} | ${values.join(", ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function aliasListFromUnknown(value: unknown) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map(String).map((item) => item.trim()).filter(Boolean));
  }
  if (typeof value === "string") {
    return uniqueStrings(value.split(/[,，;；]/).map((item) => item.trim()).filter(Boolean));
  }
  return [];
}

function importAliasGroupFor(value: string) {
  const normalized = normalizeHeader(value);
  return IMPORT_ALIAS_GROUPS.find((group) => (
    normalizeHeader(group.key) === normalized
    || group.targets.some((target) => normalizeHeader(target) === normalized)
    || normalizeHeader(group.label) === normalized
  ));
}

function customAliasLabels(config: ImportAliasConfig) {
  return IMPORT_ALIAS_GROUPS
    .filter((group) => (config[group.key] ?? []).length > 0)
    .map((group) => group.label);
}

function aliasesFor(key: string, customAliases: ImportAliasConfig) {
  const group = IMPORT_ALIAS_GROUPS.find((item) => item.key === key);
  if (!group) return [];
  return uniqueStrings([...group.aliases, ...(customAliases[key] ?? [])]);
}

function pickImportValue(record: JsonObject, customAliases: ImportAliasConfig, key: string) {
  return pickRecordValue(record, aliasesFor(key, customAliases));
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeHeader(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

type ImportQualityKey =
  | "fullWeightMin"
  | "partialWeightMin"
  | "maxHoldingCaution"
  | "maxHoldingDanger"
  | "top3Caution"
  | "top3Danger"
  | "staleCautionDays"
  | "staleDangerDays";

type ImportQualityConfig = Record<ImportQualityKey, number>;
type ImportQualityOverrides = Partial<ImportQualityConfig>;
type ImportQualityPreset = {
  key: string;
  label: string;
  values: ImportQualityConfig;
};

const IMPORT_QUALITY_DEFAULTS: ImportQualityConfig = {
  fullWeightMin: 95,
  partialWeightMin: 50,
  maxHoldingCaution: 15,
  maxHoldingDanger: 30,
  top3Caution: 45,
  top3Danger: 65,
  staleCautionDays: 120,
  staleDangerDays: 180,
};

const IMPORT_QUALITY_PRESETS: ImportQualityPreset[] = [
  {
    key: "active_equity",
    label: "主动权益",
    values: IMPORT_QUALITY_DEFAULTS,
  },
  {
    key: "sector_theme",
    label: "行业主题",
    values: {
      fullWeightMin: 90,
      partialWeightMin: 40,
      maxHoldingCaution: 20,
      maxHoldingDanger: 35,
      top3Caution: 55,
      top3Danger: 75,
      staleCautionDays: 120,
      staleDangerDays: 180,
    },
  },
  {
    key: "etf",
    label: "ETF",
    values: {
      fullWeightMin: 98,
      partialWeightMin: 80,
      maxHoldingCaution: 12,
      maxHoldingDanger: 25,
      top3Caution: 35,
      top3Danger: 55,
      staleCautionDays: 30,
      staleDangerDays: 90,
    },
  },
  {
    key: "fof",
    label: "FOF",
    values: {
      fullWeightMin: 90,
      partialWeightMin: 40,
      maxHoldingCaution: 20,
      maxHoldingDanger: 40,
      top3Caution: 55,
      top3Danger: 75,
      staleCautionDays: 180,
      staleDangerDays: 365,
    },
  },
  {
    key: "hk_tech",
    label: "港股科技",
    values: {
      fullWeightMin: 90,
      partialWeightMin: 45,
      maxHoldingCaution: 18,
      maxHoldingDanger: 32,
      top3Caution: 50,
      top3Danger: 70,
      staleCautionDays: 90,
      staleDangerDays: 150,
    },
  },
];

const IMPORT_QUALITY_FIELDS: Array<{
  key: ImportQualityKey;
  label: string;
  min: number;
  max: number;
  integer?: boolean;
}> = [
  { key: "fullWeightMin", label: "完整权重下限", min: 1, max: 100 },
  { key: "partialWeightMin", label: "部分披露下限", min: 0, max: 100 },
  { key: "maxHoldingCaution", label: "Top1 提醒", min: 0, max: 100 },
  { key: "maxHoldingDanger", label: "Top1 危险", min: 0, max: 100 },
  { key: "top3Caution", label: "Top3 提醒", min: 0, max: 100 },
  { key: "top3Danger", label: "Top3 危险", min: 0, max: 100 },
  { key: "staleCautionDays", label: "披露偏旧天数", min: 0, max: 2000, integer: true },
  { key: "staleDangerDays", label: "披露严重滞后天数", min: 0, max: 2000, integer: true },
];

function parseImportQualityLines(value: string): ImportQualityOverrides {
  const config: ImportQualityOverrides = {};
  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [rawKey = "", rawValue = ""] = line.split("|").map((part) => part.trim());
    const field = importQualityFieldFor(rawKey);
    if (!field || !rawValue) continue;
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) continue;
    config[field.key] = field.integer ? Math.round(numeric) : roundNumber(numeric, 4);
  }
  return config;
}

function importQualityFor(value: string): ImportQualityConfig {
  return {
    ...IMPORT_QUALITY_DEFAULTS,
    ...parseImportQualityLines(value),
  };
}

function importQualityToText(value: unknown, fallback: string) {
  const quality = asObject(value);
  if (!Object.keys(quality).length) return fallback;
  return IMPORT_QUALITY_FIELDS
    .map((field) => {
      const numeric = numberFrom(quality[field.key], Number.NaN);
      return Number.isFinite(numeric) ? `${field.key} | ${numeric}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function importQualityPresetToText(preset: ImportQualityPreset) {
  return IMPORT_QUALITY_FIELDS
    .map((field) => `${field.key} | ${preset.values[field.key]}`)
    .join("\n");
}

function validateImportQualityText(value: string) {
  const parsed = parseImportQualityLines(value);
  for (const [index, rawLine] of value.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const [rawKey = "", rawValue = ""] = line.split("|").map((part) => part.trim());
    const field = importQualityFieldFor(rawKey);
    if (!field || !rawValue) {
      return `导入质检阈值第 ${index + 1} 行需要使用：阈值项 | 数字。`;
    }
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < field.min || numeric > field.max) {
      return `导入质检阈值 ${field.key} 需要在 ${field.min}-${field.max} 之间。`;
    }
  }
  const quality = { ...IMPORT_QUALITY_DEFAULTS, ...parsed };
  if (quality.partialWeightMin > quality.fullWeightMin) {
    return "导入质检阈值 partialWeightMin 不能高于 fullWeightMin。";
  }
  if (quality.maxHoldingCaution > quality.maxHoldingDanger) {
    return "导入质检阈值 maxHoldingCaution 不能高于 maxHoldingDanger。";
  }
  if (quality.top3Caution > quality.top3Danger) {
    return "导入质检阈值 top3Caution 不能高于 top3Danger。";
  }
  if (quality.staleCautionDays > quality.staleDangerDays) {
    return "导入质检阈值 staleCautionDays 不能高于 staleDangerDays。";
  }
  return "";
}

function importQualityFieldFor(value: string) {
  const normalized = normalizeHeader(value);
  return IMPORT_QUALITY_FIELDS.find((field) => (
    normalizeHeader(field.key) === normalized
    || normalizeHeader(field.label) === normalized
  ));
}

type ImportAnalysisTemplateKey =
  | "labelPositive"
  | "labelCaution"
  | "labelNegative"
  | "headlinePositive"
  | "headlineCaution"
  | "headlineNegative"
  | "shortPositive"
  | "shortCaution"
  | "shortNegative"
  | "longPositive"
  | "longCaution"
  | "longNegative"
  | "riskFallback"
  | "confirmNormal"
  | "confirmDataIssue";

type ImportAnalysisTemplateConfig = Record<ImportAnalysisTemplateKey, string>;
type ImportAnalysisTemplateOverrides = Partial<ImportAnalysisTemplateConfig>;

const IMPORT_ANALYSIS_TEMPLATE_DEFAULTS: ImportAnalysisTemplateConfig = {
  labelPositive: "可试探",
  labelCaution: "观察",
  labelNegative: "防守",
  headlinePositive: "{state}：导入质量可用，但仍按条件分批。",
  headlineCaution: "{state}：{action}。",
  headlineNegative: "{state}：导入后先防守，不做进攻解释。",
  shortPositive: "{summary} 导入权重 {totalWeight}%，短线只适合按确认条件分批试探。",
  shortCaution: "{summary} 当前重点不是追强，等待{conditionLabel}：{condition}",
  shortNegative: "当前 {state}，{action}；先修复 {issueLabel}，不要把导入持仓直接当短线信号。",
  longPositive: "长线可以围绕 {benchmark} 做相对强弱跟踪，但仍以状态机修复为准。",
  longCaution: "{fund} 长线判断要重点盯 {topSymbol} 与 Top 持仓同步性，避免把集中度误读成安全边际。",
  longNegative: "{dataIssueMessage} 长线分析需要补齐权重、披露日或净值对照。",
  riskFallback: "未发现明显导入层风险，仍需跟踪市场波动和核心持仓变化。",
  confirmNormal: "{condition} 同时确认 Top 持仓不再弱于基准，净值或核心标的没有继续扩散转弱。",
  confirmDataIssue: "先补齐可用持仓数据；然后等待 {condition}",
};

const IMPORT_ANALYSIS_TEMPLATE_FIELDS: Array<{
  key: ImportAnalysisTemplateKey;
  label: string;
}> = [
  { key: "labelPositive", label: "正向标签" },
  { key: "labelCaution", label: "观察标签" },
  { key: "labelNegative", label: "防守标签" },
  { key: "headlinePositive", label: "正向标题" },
  { key: "headlineCaution", label: "观察标题" },
  { key: "headlineNegative", label: "防守标题" },
  { key: "shortPositive", label: "短线正向" },
  { key: "shortCaution", label: "短线观察" },
  { key: "shortNegative", label: "短线防守" },
  { key: "longPositive", label: "长线正向" },
  { key: "longCaution", label: "长线观察" },
  { key: "longNegative", label: "长线防守" },
  { key: "riskFallback", label: "风险兜底" },
  { key: "confirmNormal", label: "确认条件" },
  { key: "confirmDataIssue", label: "数据确认" },
];

function parseImportAnalysisTemplateLines(value: string): ImportAnalysisTemplateOverrides {
  const config: ImportAnalysisTemplateOverrides = {};
  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [rawKey, rawValue] = splitConfigLine(line);
    const field = importAnalysisTemplateFieldFor(rawKey);
    if (!field || !rawValue) continue;
    config[field.key] = rawValue;
  }
  return config;
}

function importAnalysisTemplateFor(value: string): ImportAnalysisTemplateConfig {
  return {
    ...IMPORT_ANALYSIS_TEMPLATE_DEFAULTS,
    ...parseImportAnalysisTemplateLines(value),
  };
}

function importAnalysisTemplateToText(value: unknown, fallback: string) {
  const template = asObject(value);
  if (!Object.keys(template).length) return fallback;
  return IMPORT_ANALYSIS_TEMPLATE_FIELDS
    .map((field) => {
      const text = textFrom(template[field.key], "");
      return text ? `${field.key} | ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function validateImportAnalysisTemplateText(value: string) {
  for (const [index, rawLine] of value.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const [rawKey, rawValue] = splitConfigLine(line);
    const field = importAnalysisTemplateFieldFor(rawKey);
    if (!field || !rawValue) {
      return `导入分析模板第 ${index + 1} 行需要使用：模板项 | 文案。`;
    }
    if (rawValue.length > 220) {
      return `导入分析模板 ${field.key} 文案建议控制在 220 字以内。`;
    }
  }
  return "";
}

function importAnalysisTemplateFieldFor(value: string) {
  const normalized = normalizeHeader(value);
  return IMPORT_ANALYSIS_TEMPLATE_FIELDS.find((field) => (
    normalizeHeader(field.key) === normalized
    || normalizeHeader(field.label) === normalized
  ));
}

function splitConfigLine(line: string): [string, string] {
  const separator = line.indexOf("|");
  if (separator < 0) return [line.trim(), ""];
  return [
    line.slice(0, separator).trim(),
    line.slice(separator + 1).trim(),
  ];
}

const AI_RECIPE_SCHEMA = "rportfolio.aiRecipe.v1";
const LEGACY_AI_RECIPE_SCHEMA = "rmarket.aiRecipe.v1";

function buildAiRecipePrompt(draft: ProfileDraft, report: MarketAnalysisReport) {
  const example = JSON.stringify(buildAiRecipeExample(draft, report), null, 2);
  const aliasKeys = IMPORT_ALIAS_GROUPS.map((group) => group.key).join(", ");
  const qualityKeys = IMPORT_QUALITY_FIELDS.map((field) => `${field.key}(${field.min}-${field.max})`).join(", ");
  const analysisKeys = IMPORT_ANALYSIS_TEMPLATE_FIELDS.map((field) => field.key).join(", ");
  return [
    "你是 rPortfolio 的 AI Recipe 生成器。请根据用户提供的基金、基准、持仓字段和分析目标，生成一个可导入 Profile Builder 的受控 JSON。",
    "",
    "输出要求：",
    `- 只输出 JSON，不要 Markdown、注释或额外解释。`,
    `- schema 必须是 "${AI_RECIPE_SCHEMA}"，intent 使用 "fund_profile"。`,
    "- 不要生成完整 profile；只生成 recipe 支持的字段。",
    "- 不确定的字段可以省略，不要编造基金经理、管理人或净值代码。",
    "- importAliases 的 key 只能从支持列表选择。",
    "- importQuality 使用数字阈值，避免字符串。",
    "- importAnalysis 文案需要短、可执行、适合桌面端分析卡片。",
    "",
    "当前草稿上下文：",
    `- market: ${draft.market || report.profileMarket}`,
    `- benchmark: ${normalizeSymbol(draft.benchmarkSymbol || report.backtest.benchmarkSymbol)} (${draft.benchmarkName || report.profileMandate.benchmarkName})`,
    `- fund: ${draft.fundName || "未命名基金"} (${draft.fundCode || "未配置代码"})`,
    `- fundType: ${draft.fundType || "active_equity"}`,
    `- objective: ${draft.objective || report.profileMandate.objective}`,
    "",
    "支持字段：",
    "- top-level: schema, intent, market, description, objective, fundType, benchmark, fund, importAliases, importQuality, importAnalysis, stateProtocol, backtestPolicy",
    `- importAliases keys: ${aliasKeys}`,
    `- importQuality keys and ranges: ${qualityKeys}`,
    `- importAnalysis keys: ${analysisKeys}`,
    "- benchmark: { symbol, name }",
    "- fund: { code, name, fundType, manager, issuer, navSymbol, holdingsSource }",
    "- stateProtocol/backtestPolicy 当前只进入预览提示，不会直接编译进 profile。",
    "",
    "参考输出形状：",
    example,
  ].join("\n");
}

function buildAiRecipeExample(draft: ProfileDraft, report: MarketAnalysisReport): JsonObject {
  const aliases = parseImportAliasLines(draft.importAliasesText);
  const analysis = parseImportAnalysisTemplateLines(draft.importAnalysisText);
  return {
    schema: AI_RECIPE_SCHEMA,
    intent: "fund_profile",
    market: draft.market.trim() || report.profileMarket,
    description: draft.description.trim() || `${draft.fundName || report.profileName} 的 AI 生成配置 Recipe`,
    objective: draft.objective.trim() || report.profileMandate.objective,
    fundType: draft.fundType.trim() || "active_equity",
    benchmark: {
      symbol: normalizeSymbol(draft.benchmarkSymbol || report.backtest.benchmarkSymbol),
      name: draft.benchmarkName.trim() || report.profileMandate.benchmarkName,
    },
    fund: {
      code: draft.fundCode.trim(),
      name: draft.fundName.trim() || report.profileFund?.name || report.profileName,
      fundType: draft.fundType.trim() || "active_equity",
      manager: draft.fundManager.trim(),
      issuer: draft.fundIssuer.trim(),
      navSymbol: normalizeSymbol(draft.fundNavSymbol),
      holdingsSource: draft.fundHoldingsSource.trim() || "official_disclosure",
    },
    importAliases: Object.keys(aliases).length ? aliases : defaultRecipeImportAliases(),
    importQuality: importQualityFor(draft.importQualityText),
    importAnalysis: Object.keys(analysis).length ? analysis : defaultRecipeImportAnalysis(draft),
    stateProtocol: {
      healthy: "允许分批",
      observe: "等待确认",
      broken: "停止加仓",
      panic: "主动降风险",
    },
    backtestPolicy: {
      horizons: [5, 10, 20, 60],
      minimumSamples: 12,
    },
  };
}

function defaultRecipeImportAliases(): ImportAliasConfig {
  return {
    symbol: ["证券代码", "代码", "Wind代码"],
    label: ["证券名称", "名称"],
    weight: ["持仓比例", "占净值比例"],
    sector: ["行业", "板块"],
    fundHoldingsAsOf: ["报告截止日", "持仓披露日"],
  };
}

function defaultRecipeImportAnalysis(draft: ProfileDraft): ImportAnalysisTemplateOverrides {
  const fund = draft.fundName.trim() || "该基金";
  return {
    headlineCaution: "{state}：{action}，等待修复确认。",
    shortCaution: "{summary} 不追价，等待{conditionLabel}：{condition}",
    longCaution: `${fund} 先按候选池跟踪，重点盯 {topSymbol} 与基准相对强弱。`,
    confirmNormal: "{condition}，且 Top 持仓不再弱于基准。",
  };
}

function parseAiRecipeImport(content: string, filename: string, draft: ProfileDraft): AiRecipeImport {
  const root = asObject(JSON.parse(content) as unknown);
  if (!Object.keys(root).length) {
    throw new Error("AI Recipe 需要是一个 JSON object。");
  }
  const schema = textFrom(root.schema, AI_RECIPE_SCHEMA);
  if (schema !== AI_RECIPE_SCHEMA && schema !== LEGACY_AI_RECIPE_SCHEMA) {
    throw new Error(`AI Recipe schema 不支持：${schema}。当前仅支持 ${AI_RECIPE_SCHEMA}。`);
  }

  const warnings: string[] = [];
  const ignoredSections: string[] = [];
  const patch: Partial<ProfileDraft> = {};
  if (schema === LEGACY_AI_RECIPE_SCHEMA) {
    warnings.push(`schema=${LEGACY_AI_RECIPE_SCHEMA} 是旧版 schema，已按 ${AI_RECIPE_SCHEMA} 兼容导入。`);
  }
  const intent = textFrom(root.intent, "fund_profile");
  if (intent && intent !== "fund_profile") {
    warnings.push(`intent=${intent} 不是当前推荐的 fund_profile，将按基金模板 Recipe 处理。`);
  }

  addRecipePatch(patch, "market", textFrom(root.market, ""));
  addRecipePatch(patch, "description", textFrom(root.description, ""));
  addRecipePatch(patch, "objective", textFrom(root.objective, ""));
  addRecipePatch(patch, "fundType", textFrom(root.fundType, ""));

  const benchmark = asObject(root.benchmark);
  addRecipePatch(patch, "benchmarkSymbol", normalizeSymbol(textFrom(benchmark.symbol, "")));
  addRecipePatch(patch, "benchmarkName", textFrom(benchmark.name, ""));

  const fund = asObject(root.fund);
  addRecipePatch(patch, "fundCode", textFrom(fund.code, textFrom(root.fundCode, "")));
  addRecipePatch(patch, "fundName", textFrom(fund.name, textFrom(root.fundName, "")));
  addRecipePatch(patch, "fundType", textFrom(fund.fundType, textFrom(root.fundType, "")));
  addRecipePatch(patch, "fundManager", textFrom(fund.manager, ""));
  addRecipePatch(patch, "fundIssuer", textFrom(fund.issuer, ""));
  addRecipePatch(patch, "fundNavSymbol", normalizeSymbol(textFrom(fund.navSymbol, "")));
  addRecipePatch(patch, "fundHoldingsSource", textFrom(fund.holdingsSource, ""));

  if (isNonEmptyObject(root.importAliases)) {
    const aliasText = importAliasesToText(root.importAliases, "");
    if (aliasText) {
      patch.importAliasesText = aliasText;
    }
    const unknown = unsupportedObjectKeys(root.importAliases, (key) => Boolean(importAliasGroupFor(key)));
    if (unknown.length) warnings.push(`importAliases 忽略未知目标：${unknown.join(", ")}。`);
  }
  if (isNonEmptyObject(root.importQuality)) {
    const qualityText = importQualityToText(root.importQuality, "");
    if (qualityText) {
      patch.importQualityText = qualityText;
    }
    const unknown = unsupportedObjectKeys(root.importQuality, (key) => Boolean(importQualityFieldFor(key)));
    if (unknown.length) warnings.push(`importQuality 忽略未知阈值：${unknown.join(", ")}。`);
  }
  if (isNonEmptyObject(root.importAnalysis)) {
    const analysisText = importAnalysisTemplateToText(root.importAnalysis, "");
    if (analysisText) {
      patch.importAnalysisText = analysisText;
    }
    const unknown = unsupportedObjectKeys(root.importAnalysis, (key) => Boolean(importAnalysisTemplateFieldFor(key)));
    if (unknown.length) warnings.push(`importAnalysis 忽略未知模板项：${unknown.join(", ")}。`);
  }

  if (isNonEmptyObject(root.stateProtocol)) {
    ignoredSections.push("stateProtocol");
  }
  if (isNonEmptyObject(root.backtestPolicy)) {
    ignoredSections.push("backtestPolicy");
  }

  const validation = validateRecipePatch(patch);
  if (validation) {
    throw new Error(validation);
  }

  const diffs = recipeDiffs(draft, patch);
  if (!diffs.length) {
    throw new Error("AI Recipe 没有产生可应用的草稿变更。");
  }

  return {
    sourceName: filename,
    schema,
    intent,
    draftPatch: Object.fromEntries(diffs.map((item) => [item.key, patch[item.key] ?? ""])) as Partial<ProfileDraft>,
    diffs,
    warnings,
    ignoredSections,
  };
}

function addRecipePatch(patch: Partial<ProfileDraft>, key: keyof ProfileDraft, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    patch[key] = trimmed;
  }
}

function validateRecipePatch(patch: Partial<ProfileDraft>) {
  if (patch.importAliasesText) {
    const validation = validateImportAliasText(patch.importAliasesText);
    if (validation) return validation;
  }
  if (patch.importQualityText) {
    const validation = validateImportQualityText(patch.importQualityText);
    if (validation) return validation;
  }
  if (patch.importAnalysisText) {
    const validation = validateImportAnalysisTemplateText(patch.importAnalysisText);
    if (validation) return validation;
  }
  return "";
}

function recipeDiffs(draft: ProfileDraft, patch: Partial<ProfileDraft>) {
  const labels: Partial<Record<keyof ProfileDraft, string>> = {
    market: "市场",
    description: "描述",
    objective: "投资目标",
    benchmarkSymbol: "基准代码",
    benchmarkName: "基准名称",
    fundCode: "基金代码",
    fundName: "基金名称",
    fundType: "基金类型",
    fundManager: "基金经理",
    fundIssuer: "管理人",
    fundNavSymbol: "净值代码",
    fundHoldingsSource: "持仓来源",
    importAliasesText: "导入字段映射",
    importQualityText: "导入质检阈值",
    importAnalysisText: "导入分析模板",
  };
  return (Object.keys(labels) as Array<keyof ProfileDraft>)
    .map((key) => {
      const after = String(patch[key] ?? "").trim();
      const before = String(draft[key] ?? "").trim();
      if (!after || after === before) return null;
      return {
        key,
        label: labels[key] ?? key,
        before,
        after,
        tone: recipeDiffTone(key),
      };
    })
    .filter((item): item is AiRecipeDiff => item !== null);
}

function recipeDiffTone(key: keyof ProfileDraft): AiRecipeDiff["tone"] {
  if (key === "benchmarkSymbol" || key === "benchmarkName") return "caution";
  if (key === "importAliasesText" || key === "importQualityText" || key === "importAnalysisText") return "positive";
  return "neutral";
}

function unsupportedObjectKeys(value: unknown, supported: (key: string) => boolean) {
  return Object.keys(asObject(value)).filter((key) => !supported(key));
}

function isNonEmptyObject(value: unknown) {
  return Object.keys(asObject(value)).length > 0;
}

function parseFundHoldingsImport(content: string, filename: string, draft: ProfileDraft, report: MarketAnalysisReport): FundHoldingsImport {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("持仓文件为空。");
  }
  const customAliases = parseImportAliasLines(draft.importAliasesText);
  const importQuality = importQualityFor(draft.importQualityText);
  const sourceType = filename.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "csv";
  const parsed = sourceType === "json"
    ? parseFundHoldingsJson(trimmed, filename, customAliases)
    : parseFundHoldingsCsv(trimmed, filename, customAliases);
  const fallbackCode = slugify(filename.replace(/\.[^.]+$/, ""));
  const holdings = normalizeImportedHoldings(parsed.holdings, draft.market);
  const totalWeight = roundNumber(holdings.reduce((total, item) => total + item.weight, 0), 4);
  const fundDraft = {
    fundCode: parsed.fundDraft.fundCode || draft.fundCode || fallbackCode.toUpperCase(),
    fundName: parsed.fundDraft.fundName || draft.fundName,
    fundType: parsed.fundDraft.fundType || draft.fundType || "active_equity",
    fundManager: parsed.fundDraft.fundManager || draft.fundManager,
    fundIssuer: parsed.fundDraft.fundIssuer || draft.fundIssuer,
    fundNavSymbol: parsed.fundDraft.fundNavSymbol || draft.fundNavSymbol,
    fundHoldingsAsOf: parsed.fundDraft.fundHoldingsAsOf || draft.fundHoldingsAsOf,
    fundHoldingsSource: parsed.fundDraft.fundHoldingsSource || draft.fundHoldingsSource || `file:${filename}`,
    fundNotesText: parsed.fundDraft.fundNotesText || draft.fundNotesText,
  };
  const diagnostics = buildImportDiagnostics(holdings, fundDraft, totalWeight, parsed.rowsRead, parsed.ignoredRows, draft, importQuality);
  return {
    ...parsed,
    sourceName: filename,
    sourceType,
    holdings,
    fundDraft,
    diagnostics,
    analysis: buildImportAnalysis(holdings, fundDraft, diagnostics, totalWeight, draft, report),
    customAliasFields: customAliasLabels(customAliases),
    totalWeight,
  };
}

function buildImportAnalysis(
  holdings: SymbolDraft[],
  fundDraft: Partial<ProfileDraft>,
  diagnostics: FundImportDiagnostic[],
  totalWeight: number,
  draft: ProfileDraft,
  report: MarketAnalysisReport,
): FundImportAnalysis {
  const frame = report.decisionFrame;
  const template = importAnalysisTemplateFor(draft.importAnalysisText);
  const negativeDiagnostics = diagnostics.filter((item) => item.tone === "negative");
  const cautionDiagnostics = diagnostics.filter((item) => item.tone === "caution");
  const blockingDataIssue = diagnostics.some((item) => (
    item.tone === "negative"
    && ["coverage", "freshness", "rows"].includes(item.key)
  ));
  const marketBlocked = ["broken", "panic"].includes(String(frame.protocolState));
  const permissionBlocked = frame.permissionTone === "negative";
  const edgeWeak = frame.edge.score < 45 || frame.edge.tone === "negative";
  const riskElevated = frame.risk.score >= 60 || frame.risk.tone === "negative";
  const trendConstructive = frame.trend.score >= 60 && !marketBlocked;
  const tone: FundImportAnalysisTone = blockingDataIssue || marketBlocked || permissionBlocked
    ? "negative"
    : negativeDiagnostics.length || cautionDiagnostics.length || edgeWeak || riskElevated
      ? "caution"
      : "positive";
  const maxHolding = holdings[0];
  const fundName = String(fundDraft.fundName || draft.fundName || "导入基金").trim();
  const stateLabel = frame.stateLabel || report.marketState.label || "当前状态";
  const actionLabel = frame.actionLabel || frame.permission || "等待确认";
  const conditionLabel = (frame.conditionLabel || "确认条件").replace(/[：:]+$/u, "");
  const condition = frame.condition || frame.invalidation || "等待趋势、风险和核心持仓同步确认。";
  const topRisk = negativeDiagnostics[0] ?? cautionDiagnostics[0];
  const riskDetail = topRisk
    ? `${topRisk.label}：${topRisk.message}`
    : frame.risk.detail || template.riskFallback;
  const freshness = diagnostics.find((item) => item.key === "freshness");
  const concentration = diagnostics.find((item) => item.key === "concentration");
  const coverage = diagnostics.find((item) => item.key === "coverage");
  const templateValues = {
    state: stateLabel,
    action: actionLabel,
    summary: frame.summary,
    condition,
    conditionLabel,
    fund: fundName,
    benchmark: draft.benchmarkName || draft.benchmarkSymbol || "基准",
    topSymbol: maxHolding?.symbol ?? "Top 持仓",
    totalWeight: String(roundNumber(totalWeight, 2)),
    riskScore: String(frame.risk.score),
    riskDetail,
    issueLabel: topRisk?.label ?? "数据或市场状态",
    issueMessage: topRisk?.message ?? "导入数据或当前状态仍需确认",
    dataIssueMessage: coverage?.message ?? freshness?.message ?? "导入数据质量不足",
  };
  const shortValue = tone === "negative"
    ? "不适合新增"
    : tone === "positive"
      ? "可小仓试探"
      : "买点偏差";
  const shortDetail = tone === "negative"
    ? renderImportAnalysisTemplate(template.shortNegative, templateValues)
    : tone === "positive"
      ? renderImportAnalysisTemplate(template.shortPositive, templateValues)
      : renderImportAnalysisTemplate(template.shortCaution, templateValues);
  const longValue = blockingDataIssue
    ? "仅候选观察"
    : trendConstructive
      ? "可跟踪配置"
      : "等待修复";
  const longDetail = blockingDataIssue
    ? renderImportAnalysisTemplate(template.longNegative, templateValues)
    : concentration?.tone !== "positive" && maxHolding
      ? renderImportAnalysisTemplate(template.longCaution, templateValues)
      : renderImportAnalysisTemplate(template.longPositive, templateValues);
  const confirmDetail = blockingDataIssue
    ? renderImportAnalysisTemplate(template.confirmDataIssue, templateValues)
    : renderImportAnalysisTemplate(template.confirmNormal, templateValues);
  const headline = tone === "negative"
    ? renderImportAnalysisTemplate(template.headlineNegative, templateValues)
    : tone === "positive"
      ? renderImportAnalysisTemplate(template.headlinePositive, templateValues)
      : renderImportAnalysisTemplate(template.headlineCaution, templateValues);
  return {
    tone,
    label: tone === "negative" ? template.labelNegative : tone === "positive" ? template.labelPositive : template.labelCaution,
    headline,
    items: [
      {
        key: "short-term-entry",
        label: "短线买点",
        value: shortValue,
        detail: shortDetail,
        tone,
      },
      {
        key: "long-term-entry",
        label: "长线买点",
        value: longValue,
        detail: longDetail,
        tone: blockingDataIssue ? "negative" : trendConstructive ? "positive" : "caution",
      },
      {
        key: "primary-risk",
        label: "主要风险",
        value: topRisk?.value ?? `Risk ${frame.risk.score}`,
        detail: riskDetail,
        tone: topRisk?.tone ?? (riskElevated ? "caution" : "positive"),
      },
      {
        key: "confirmation",
        label: "确认条件",
        value: conditionLabel,
        detail: confirmDetail,
        tone: tone === "positive" ? "caution" : tone,
      },
    ],
  };
}

function renderImportAnalysisTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => values[key] ?? match);
}

function buildImportDiagnostics(
  holdings: SymbolDraft[],
  fundDraft: Partial<ProfileDraft>,
  totalWeight: number,
  rowsRead: number,
  ignoredRows: number,
  draft: ProfileDraft,
  quality: ImportQualityConfig,
): FundImportDiagnostic[] {
  const diagnostics: FundImportDiagnostic[] = [];
  const maxHolding = holdings[0];
  const topThreeWeight = roundNumber(holdings.slice(0, 3).reduce((total, item) => total + item.weight, 0), 2);
  const benchmark = normalizeSymbol(draft.benchmarkSymbol);
  const holdingsAsOf = String(fundDraft.fundHoldingsAsOf ?? "").trim();

  diagnostics.push(weightCoverageDiagnostic(totalWeight, quality));
  diagnostics.push(concentrationDiagnostic(maxHolding, topThreeWeight, quality));
  diagnostics.push(holdingsFreshnessDiagnostic(holdingsAsOf, quality));
  diagnostics.push({
    key: "benchmark",
    label: "基准保留",
    value: benchmark || "未配置",
    tone: holdings.some((item) => item.symbol === benchmark) ? "positive" : "caution",
    message: holdings.some((item) => item.symbol === benchmark)
      ? "导入文件包含基准，规则和对照资产可直接衔接。"
      : "导入文件不含基准，应用时会保留原基准为 0 权重观察符号。",
  });
  diagnostics.push({
    key: "rows",
    label: "行质量",
    value: ignoredRows ? `${ignoredRows}/${rowsRead} 忽略` : `${rowsRead} 行`,
    tone: rowsRead <= 0 ? "negative" : ignoredRows ? "caution" : "positive",
    message: rowsRead <= 0
      ? "未读取到有效数据行，请检查文件表头和分隔符。"
      : ignoredRows
        ? "存在未识别行，应用前建议确认是否为空行、现金项或字段缺失。"
        : "所有读取行都转成了可识别持仓。",
  });
  return diagnostics;
}

function weightCoverageDiagnostic(totalWeight: number, quality: ImportQualityConfig): FundImportDiagnostic {
  if (totalWeight > 100.5) {
    return {
      key: "coverage",
      label: "权重覆盖",
      value: `${totalWeight}%`,
      tone: "negative",
      message: "权重超过 100%，可能存在重复行、单位混用或杠杆口径。",
    };
  }
  if (totalWeight >= quality.fullWeightMin) {
    return {
      key: "coverage",
      label: "权重覆盖",
      value: `${totalWeight}%`,
      tone: "positive",
      message: "权重接近完整组合，可作为穿透持仓使用。",
    };
  }
  if (totalWeight > 0) {
    return {
      key: "coverage",
      label: "权重覆盖",
      value: `${totalWeight}%`,
      tone: "caution",
      message: totalWeight >= quality.partialWeightMin ? "可能是部分披露，适合做主要风险穿透。" : "更像 Top 持仓样本，不宜当作完整组合权重。",
    };
  }
  return {
    key: "coverage",
    label: "权重覆盖",
    value: "0%",
    tone: "negative",
    message: "未识别有效权重，短线/长线买点判断会失真。",
  };
}

function concentrationDiagnostic(maxHolding: SymbolDraft | undefined, topThreeWeight: number, quality: ImportQualityConfig): FundImportDiagnostic {
  const maxWeight = maxHolding?.weight ?? 0;
  if (maxWeight >= quality.maxHoldingDanger || topThreeWeight >= quality.top3Danger) {
    return {
      key: "concentration",
      label: "集中度",
      value: `Top3 ${topThreeWeight}%`,
      tone: "negative",
      message: `${maxHolding?.symbol ?? "Top1"} 权重偏高，基金买点会高度依赖少数核心持仓。`,
    };
  }
  if (maxWeight >= quality.maxHoldingCaution || topThreeWeight >= quality.top3Caution) {
    return {
      key: "concentration",
      label: "集中度",
      value: `Top3 ${topThreeWeight}%`,
      tone: "caution",
      message: "Top 持仓影响较大，后续应重点看龙头趋势和回撤触发。",
    };
  }
  return {
    key: "concentration",
    label: "集中度",
    value: `Top3 ${topThreeWeight}%`,
    tone: "positive",
    message: "导入持仓未显示明显单一集中风险。",
  };
}

function holdingsFreshnessDiagnostic(value: string, quality: ImportQualityConfig): FundImportDiagnostic {
  if (!value) {
    return {
      key: "freshness",
      label: "披露时效",
      value: "缺失",
      tone: "caution",
      message: "未识别持仓披露日，短线买点需要更多依赖净值和基准。",
    };
  }
  if (!isIsoDate(value)) {
    return {
      key: "freshness",
      label: "披露时效",
      value,
      tone: "negative",
      message: "披露日不是 YYYY-MM-DD，保存前会被校验拦截。",
    };
  }
  const age = daysSinceIsoDate(value);
  if (age < 0) {
    return {
      key: "freshness",
      label: "披露时效",
      value,
      tone: "negative",
      message: "披露日在未来，可能是日期列映射错误。",
    };
  }
  if (age > quality.staleDangerDays) {
    return {
      key: "freshness",
      label: "披露时效",
      value: `${age} 天`,
      tone: "negative",
      message: "持仓明显滞后，只适合长线结构参考。",
    };
  }
  if (age > quality.staleCautionDays) {
    return {
      key: "freshness",
      label: "披露时效",
      value: `${age} 天`,
      tone: "caution",
      message: "披露已偏旧，短线买点需要净值和核心持仓同步确认。",
    };
  }
  return {
    key: "freshness",
    label: "披露时效",
    value: `${age} 天`,
    tone: "positive",
    message: "披露日期仍可用于当前持仓穿透。",
  };
}

function daysSinceIsoDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today - parsed) / 86_400_000);
}

function parseFundHoldingsJson(content: string, filename: string, customAliases: ImportAliasConfig): FundHoldingsImport {
  const value = JSON.parse(content) as unknown;
  const root = Array.isArray(value) ? {} : asObject(value);
  const rawHoldings = Array.isArray(value)
    ? value
    : firstArray(root.holdings, root.symbols, root.positions, asObject(root.portfolio).holdings);
  const fund = asObject(root.fund);
  const warnings: string[] = [];
  if (!rawHoldings.length) {
    warnings.push("JSON 未找到 holdings / symbols / positions 数组。");
  }
  const holdings = rawHoldings.map((item) => holdingFromRecord(asObject(item), customAliases)).filter((item): item is SymbolDraft => Boolean(item));
  const recognizedColumns = recognizedHoldingColumns(rawHoldings.map(asObject), customAliases);
  const fundDraft = {
    fundCode: pickImportValue(fund, customAliases, "fundCode") || pickImportValue(root, customAliases, "fundCode"),
    fundName: pickImportValue(fund, customAliases, "fundName") || pickImportValue(root, customAliases, "fundName"),
    fundType: pickImportValue(fund, customAliases, "fundType") || pickImportValue(root, customAliases, "fundType"),
    fundManager: pickImportValue(fund, customAliases, "fundManager") || pickImportValue(root, customAliases, "fundManager"),
    fundIssuer: pickImportValue(fund, customAliases, "fundIssuer") || pickImportValue(root, customAliases, "fundIssuer"),
    fundNavSymbol: normalizeSymbol(pickImportValue(fund, customAliases, "fundNavSymbol") || pickImportValue(root, customAliases, "fundNavSymbol")),
    fundHoldingsAsOf: pickImportValue(fund, customAliases, "fundHoldingsAsOf") || pickImportValue(root, customAliases, "fundHoldingsAsOf"),
    fundHoldingsSource: pickImportValue(fund, customAliases, "fundHoldingsSource") || pickImportValue(root, customAliases, "fundHoldingsSource") || `json:${filename}`,
    fundNotesText: Array.isArray(fund.notes) ? fund.notes.map(String).join("\n") : textFromAny(fund.note, root.note),
  };
  return {
    holdings,
    fundDraft,
    warnings,
    sourceName: filename,
    sourceType: "json",
    rowsRead: rawHoldings.length,
    ignoredRows: Math.max(0, rawHoldings.length - holdings.length),
    recognizedColumns,
    fundFields: recognizedFundFields(fundDraft),
    diagnostics: [],
    customAliasFields: customAliasLabels(customAliases),
    totalWeight: 0,
  };
}

function parseFundHoldingsCsv(content: string, filename: string, customAliases: ImportAliasConfig): FundHoldingsImport {
  const rows = parseDelimitedRows(content);
  if (rows.length < 2) {
    return {
      holdings: [],
      fundDraft: { fundHoldingsSource: `csv:${filename}` },
      warnings: ["CSV 至少需要表头和一行持仓。"],
      sourceName: filename,
      sourceType: "csv",
      rowsRead: 0,
      ignoredRows: 0,
      recognizedColumns: [],
      fundFields: [],
      diagnostics: [],
      customAliasFields: customAliasLabels(customAliases),
      totalWeight: 0,
    };
  }
  const [headers, ...body] = rows;
  const records = body
    .map((row) => recordFromCsv(headers, row))
    .filter((record) => Object.values(record).some((value) => String(value).trim()));
  const holdings = records.map((record) => holdingFromRecord(record, customAliases)).filter((item): item is SymbolDraft => Boolean(item));
  const fundDraft = {
    fundCode: pickImportValue(records[0] ?? {}, customAliases, "fundCode"),
    fundName: pickImportValue(records[0] ?? {}, customAliases, "fundName"),
    fundType: pickImportValue(records[0] ?? {}, customAliases, "fundType"),
    fundManager: pickImportValue(records[0] ?? {}, customAliases, "fundManager"),
    fundIssuer: pickImportValue(records[0] ?? {}, customAliases, "fundIssuer"),
    fundNavSymbol: normalizeSymbol(pickImportValue(records[0] ?? {}, customAliases, "fundNavSymbol")),
    fundHoldingsAsOf: pickImportValue(records[0] ?? {}, customAliases, "fundHoldingsAsOf"),
    fundHoldingsSource: `csv:${filename}`,
  };
  return {
    holdings,
    fundDraft,
    warnings: [],
    sourceName: filename,
    sourceType: "csv",
    rowsRead: records.length,
    ignoredRows: Math.max(0, records.length - holdings.length),
    recognizedColumns: recognizedCsvColumns(headers, customAliases),
    fundFields: recognizedFundFields(fundDraft),
    diagnostics: [],
    customAliasFields: customAliasLabels(customAliases),
    totalWeight: 0,
  };
}

function holdingFromRecord(record: JsonObject, customAliases: ImportAliasConfig): SymbolDraft | null {
  const symbol = normalizeSymbol(pickImportValue(record, customAliases, "symbol"));
  if (!symbol) return null;
  const yahooSymbol = normalizeSymbol(pickImportValue(record, customAliases, "yahooSymbol")) || symbol;
  return {
    symbol,
    label: pickImportValue(record, customAliases, "label") || symbol,
    role: pickImportValue(record, customAliases, "role"),
    weight: parseWeightValue(pickImportValue(record, customAliases, "weight")),
    sector: pickImportValue(record, customAliases, "sector"),
    style: pickImportValue(record, customAliases, "style"),
    exposure: pickImportValue(record, customAliases, "exposure"),
    yahooSymbol,
  };
}

function recognizedCsvColumns(headers: string[], customAliases: ImportAliasConfig) {
  return IMPORT_ALIAS_GROUPS
    .filter((group) => HOLDING_IMPORT_ALIAS_KEYS.includes(group.key))
    .filter((group) => headers.some((header) => aliasesFor(group.key, customAliases).map(normalizeHeader).includes(normalizeHeader(header))))
    .map((group) => group.label);
}

function recognizedHoldingColumns(records: JsonObject[], customAliases: ImportAliasConfig) {
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return recognizedCsvColumns(headers, customAliases);
}

function recognizedFundFields(fundDraft: Partial<ProfileDraft>) {
  const fields: Array<[keyof ProfileDraft, string]> = [
    ["fundCode", "代码"],
    ["fundName", "名称"],
    ["fundType", "类型"],
    ["fundManager", "经理"],
    ["fundIssuer", "管理人"],
    ["fundNavSymbol", "净值"],
    ["fundHoldingsAsOf", "披露日"],
    ["fundHoldingsSource", "来源"],
  ];
  return fields
    .filter(([key]) => String(fundDraft[key] ?? "").trim())
    .map(([, label]) => label);
}

function normalizeImportedHoldings(holdings: SymbolDraft[], market: string): SymbolDraft[] {
  const bySymbol = new Map<string, SymbolDraft>();
  for (const holding of holdings) {
    if (!holding.symbol || !Number.isFinite(holding.weight) || holding.weight < 0) continue;
    const existing = bySymbol.get(holding.symbol);
    bySymbol.set(holding.symbol, {
      ...holding,
      label: holding.label || existing?.label || holding.symbol,
      role: holding.role || existing?.role || "",
      weight: roundNumber((existing?.weight ?? 0) + holding.weight, 4),
      sector: holding.sector || existing?.sector || "",
      style: holding.style || existing?.style || "",
      exposure: holding.exposure || existing?.exposure || market.toUpperCase(),
      yahooSymbol: holding.yahooSymbol || existing?.yahooSymbol || holding.symbol,
    });
  }
  return [...bySymbol.values()].sort((left, right) => right.weight - left.weight);
}

function mergeImportedHoldings(currentText: string, imported: SymbolDraft[], benchmarkSymbol: string): SymbolDraft[] {
  const current = parseHoldingLines(currentText);
  const importedSymbols = new Set(imported.map((item) => item.symbol));
  const merged = [...imported];
  const benchmark = normalizeSymbol(benchmarkSymbol);
  for (const item of current) {
    if (importedSymbols.has(item.symbol)) continue;
    const shouldKeep = item.symbol === benchmark || item.role === "benchmark" || item.role === "volatility" || item.weight <= 0;
    if (shouldKeep) {
      merged.push({ ...item, weight: 0 });
    }
  }
  return merged;
}

function holdingsDraftsToText(items: SymbolDraft[]) {
  return items
    .map((item) => [
      item.symbol,
      item.label,
      item.role,
      roundNumber(item.weight, 4),
      item.sector,
      item.style,
      item.exposure,
      item.yahooSymbol,
    ].join(" | "))
    .join("\n");
}

function firstArray(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function parseDelimitedRows(content: string) {
  const delimiter = inferDelimiter(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function inferDelimiter(content: string) {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

function recordFromCsv(headers: string[], row: string[]): JsonObject {
  const record: JsonObject = {};
  headers.forEach((header, index) => {
    record[header.trim()] = row[index] ?? "";
  });
  return record;
}

function pickRecordValue(record: JsonObject, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  for (const [key, value] of Object.entries(record)) {
    if (normalizedAliases.has(normalizeHeader(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_.\-/%()（）]/g, "");
}

function parseWeightValue(value: string) {
  const cleaned = value.replace(/,/g, "").replace("%", "").trim();
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return 0;
  if (!value.includes("%") && numeric > 0 && numeric <= 1) return roundNumber(numeric * 100, 4);
  return roundNumber(numeric, 4);
}

function textFromAny(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeProfileSymbols(baseValue: unknown, drafts: SymbolDraft[]): JsonObject[] {
  const baseSymbols = Array.isArray(baseValue)
    ? baseValue.map((item) => asObject(item)).filter((item) => typeof item.symbol === "string")
    : [];
  const bySymbol = new Map(baseSymbols.map((item) => [normalizeSymbol(String(item.symbol)), item]));
  const ordered = baseSymbols.map((item) => normalizeSymbol(String(item.symbol)));

  for (const draft of drafts) {
    const existing = bySymbol.get(draft.symbol) ?? {};
    bySymbol.set(draft.symbol, cleanSymbolObject({
      ...existing,
      symbol: draft.symbol,
      label: draft.label || textFrom(existing.label, draft.symbol),
      role: draft.role || textFrom(existing.role, ""),
      weight: draft.weight,
      sector: draft.sector || textFrom(existing.sector, ""),
      style: draft.style || textFrom(existing.style, ""),
      exposure: draft.exposure || textFrom(existing.exposure, ""),
      yahooSymbol: draft.yahooSymbol || textFrom(existing.yahooSymbol, draft.symbol),
    }));
    if (!ordered.includes(draft.symbol)) {
      ordered.push(draft.symbol);
    }
  }

  return ordered.map((symbol) => bySymbol.get(symbol)).filter((item): item is JsonObject => Boolean(item));
}

function cleanSymbolObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== ""));
}

function portfolioStats(draft: ProfileDraft) {
  const symbols = parseHoldingLines(draft.holdingsText);
  const totalWeight = symbols.reduce((total, item) => total + (Number.isFinite(item.weight) ? item.weight : 0), 0);
  const benchmark = normalizeSymbol(draft.benchmarkSymbol);
  const benchmarkStatus = symbols.some((item) => item.symbol === benchmark) ? `基准 ${benchmark}` : `缺少基准 ${benchmark}`;
  return {
    count: symbols.length,
    totalWeight: Math.round(totalWeight * 10) / 10,
    benchmarkStatus,
  };
}

function dimensionsToText(value: unknown) {
  if (!Array.isArray(value)) return "";
  const lines: string[] = [];
  for (const dimensionValue of value) {
    const dimension = asObject(dimensionValue);
    const rules = Array.isArray(dimension.rules) ? dimension.rules : [];
    for (const ruleValue of rules) {
      const rule = asObject(ruleValue);
      lines.push([
        textFrom(dimension.key, ""),
        textFrom(dimension.label, textFrom(dimension.key, "")),
        textFrom(dimension.factor, ""),
        numberFrom(dimension.weight, 0),
        textFrom(rule.type, ""),
        ruleSymbolLabel(rule),
        numberFrom(rule.points, 0),
        textFrom(rule.reason, ""),
        ruleOptionsToText(rule),
      ].join(" | "));
    }
  }
  return lines.join("\n");
}

function parseRuleLines(value: string): RuleDraft[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [dimensionKey = "", dimensionLabel = "", factor = "", dimensionWeight = "0", ruleType = "", symbol = "", points = "0", reason = "", options = ""] = line
        .split("|")
        .map((part) => part.trim());
      const rule: JsonObject = {
        type: ruleType,
        points: Number(points),
        reason,
        ...parseRuleOptions(options),
      };
      const symbolParts = symbol.split(",").map((part) => normalizeSymbol(part)).filter(Boolean);
      if (symbolParts.length > 1) {
        rule.symbols = symbolParts;
      } else if (symbolParts[0]) {
        rule.symbol = symbolParts[0];
      }
      return {
        dimensionKey: slugifyDimension(dimensionKey),
        dimensionLabel: dimensionLabel || dimensionKey,
        factor,
        dimensionWeight: Number(dimensionWeight),
        rule,
      };
    });
}

function mergeProfileDimensions(baseValue: unknown, drafts: RuleDraft[]): JsonObject[] {
  const baseDimensions = Array.isArray(baseValue)
    ? baseValue.map((item) => asObject(item)).filter((item) => typeof item.key === "string")
    : [];
  if (!drafts.length) return baseDimensions;

  const grouped = new Map<string, RuleDraft[]>();
  for (const draft of drafts) {
    const rules = grouped.get(draft.dimensionKey) ?? [];
    rules.push(draft);
    grouped.set(draft.dimensionKey, rules);
  }

  const byKey = new Map(baseDimensions.map((item) => [String(item.key), item]));
  const ordered = baseDimensions.map((item) => String(item.key));
  for (const [key, rules] of grouped) {
    const first = rules[0];
    const existing = byKey.get(key) ?? {};
    byKey.set(key, cleanDimensionObject({
      ...existing,
      key,
      label: first.dimensionLabel || textFrom(existing.label, key),
      factor: first.factor || textFrom(existing.factor, ""),
      weight: first.dimensionWeight,
      rules: rules.map((item) => cleanRuleObject(item.rule)),
    }));
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered.map((key) => byKey.get(key)).filter((item): item is JsonObject => Boolean(item));
}

function validateRulesText(value: string) {
  const lines = value.split("\n");
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 8) {
      return `规则第 ${index + 1} 行至少需要 8 列。`;
    }
    const [dimensionKey, , , dimensionWeight, ruleType, , points] = parts;
    if (!slugifyDimension(dimensionKey)) {
      return `规则第 ${index + 1} 行缺少 dimension key。`;
    }
    if (!ruleType) {
      return `规则第 ${index + 1} 行缺少 rule type。`;
    }
    if (!Number.isFinite(Number(dimensionWeight)) || Number(dimensionWeight) < 0) {
      return `规则第 ${index + 1} 行的维度权重需要是大于等于 0 的数字。`;
    }
    if (!Number.isFinite(Number(points)) || Number(points) < 0 || Number(points) > 100) {
      return `规则第 ${index + 1} 行的 points 需要是 0-100 之间的数字。`;
    }
    const signature = parts.slice(0, 8).join("|");
    if (seen.has(signature)) {
      return `规则第 ${index + 1} 行重复。`;
    }
    seen.add(signature);
  }
  return "";
}

function ruleStats(draft: ProfileDraft) {
  const rules = parseRuleLines(draft.rulesText);
  return {
    dimensions: new Set(rules.map((item) => item.dimensionKey)).size,
    rules: rules.length,
  };
}

function ruleSymbolLabel(rule: JsonObject) {
  if (Array.isArray(rule.symbols)) {
    return rule.symbols.map(String).join(",");
  }
  return textFrom(rule.symbol, "");
}

function ruleOptionsToText(rule: JsonObject) {
  const omitted = new Set(["type", "symbol", "symbols", "points", "reason"]);
  return Object.entries(rule)
    .filter(([key, value]) => !omitted.has(key) && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}=${value.join(",")}`;
      }
      return `${key}=${String(value)}`;
    })
    .join(";");
}

function parseRuleOptions(value: string): JsonObject {
  const options: JsonObject = {};
  for (const chunk of value.split(";")) {
    const [rawKey, rawValue] = chunk.split("=").map((part) => part.trim());
    if (!rawKey || rawValue == null || rawValue === "") continue;
    if (rawKey === "symbols") {
      options.symbols = rawValue.split(",").map((part) => normalizeSymbol(part)).filter(Boolean);
      continue;
    }
    const numeric = Number(rawValue);
    options[rawKey] = Number.isFinite(numeric) && rawValue !== "" ? numeric : rawValue;
  }
  return options;
}

function cleanDimensionObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== ""));
}

function cleanRuleObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && !(Array.isArray(item) && item.length === 0)));
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function textFrom(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberFrom(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function defaultCurrency(market: string) {
  if (market === "hk") return "HKD";
  if (market === "cn") return "CNY";
  return "USD";
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}

function isVolatilitySymbol(symbol: string) {
  return normalizeSymbol(symbol).includes("VIX");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function slugifyDimension(value: string) {
  return slugify(value) || value.trim().toLowerCase();
}

async function copyTextToClipboard(content: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("当前环境不允许写入剪贴板，请改用下载示例。");
  }
}

function downloadJson(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
