import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDataSourceSummaries,
  fetchMarketAnalysisReport,
  fetchProfileSummaries,
} from "../lib/analysis";
import type {
  DataSource,
  DataSourceSummary,
  MarketAnalysisReport,
  ProfileSummary,
} from "../lib/types";

type MarketAnalysisDefaults = {
  defaultProfile?: string;
  defaultSource?: DataSource;
};

export function useMarketAnalysis(defaults: MarketAnalysisDefaults = {}) {
  const [source, setSource] = useState<DataSource>(defaults.defaultSource ?? "auto");
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [profile, setProfile] = useState(defaults.defaultProfile ?? "us-core");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [asOf, setAsOf] = useState("");
  const [report, setReport] = useState<MarketAnalysisReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const didInitialRefresh = useRef(false);
  const requestSeq = useRef(0);

  const reloadProfiles = useCallback(async () => {
    try {
      const nextProfiles = await fetchProfileSummaries();
      setProfiles(nextProfiles);
      return nextProfiles;
    } catch {
      setProfiles([]);
      return [];
    }
  }, []);

  const refresh = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    setError("");

    try {
      const nextReport = await fetchMarketAnalysisReport({
        source,
        asOf: asOf || undefined,
        profile,
      });
      if (seq !== requestSeq.current) {
        return;
      }
      setReport(nextReport);
      if (!asOf) {
        setAsOf(nextReport.asOf);
      }
    } catch (nextError) {
      if (seq !== requestSeq.current) {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "风险数据刷新失败");
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
      }
    }
  }, [asOf, profile, source]);

  useEffect(() => {
    void reloadProfiles();
    void fetchDataSourceSummaries()
      .then(setDataSources)
      .catch(() => setDataSources([]));
    void refresh();
    didInitialRefresh.current = true;
    // Initial load only; explicit refresh handles later source/date changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadProfiles]);

  useEffect(() => {
    if (!didInitialRefresh.current) {
      return;
    }
    void refresh();
  }, [profile, refresh, source]);

  return {
    asOf,
    dataSources,
    error,
    loading,
    profile,
    profiles,
    reloadProfiles,
    refresh,
    report,
    setAsOf,
    setProfile,
    setSource,
    source,
  };
}
