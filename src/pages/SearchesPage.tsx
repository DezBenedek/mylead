import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustments,
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconEdit,
  IconInfinity,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconSend,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { api, formatShortDate, LEAD_STATUS_META } from "../lib/api";
import type { Lead, Project, SearchJob, SearchLiveEvent } from "../types";

interface Props {
  projects: Project[];
  searches: SearchJob[];
  leads: Lead[];
  activeSearchId: string | null;
  runningSearchIds: string[];
  enrichingLeadIds: string[];
  liveLogsBySearch: Record<string, SearchLiveEvent[]>;
  liveActiveWorkersBySearch: Record<string, Record<string, SearchLiveEvent>>;
  onSelectSearchId: (id: string | null) => void;
  onSelectLead: (lead: Lead) => void;
  onEnrichLeads: (leadIds: string[], projectId?: string | null) => void;
  onRefresh: () => Promise<void>;
  onCreateCampaignFromSearch: (search: SearchJob) => void;
}

const SOURCE_SELECT_DATA = [
  {
    group: "Ajánlott (API kulcs nélkül, nyílt forráskódú)",
    items: [
      { value: "smart_hybrid", label: "Okos Hibrid (DDGS + OSM + Scraper + CLI)" },
      { value: "duckduckgo", label: "DuckDuckGo / DDGS (Több kereséses web)" },
      { value: "gmaps_scraper", label: "Open-Source Google Maps Scraper (gosom)" },
      { value: "ai_cli_search", label: "CLI Beépített Webkereső (OpenCode / Claude / Codex)" },
      { value: "osm", label: "OpenStreetMap (Nominatim + Overpass)" },
      { value: "searxng", label: "SearXNG (Saját nyílt meta-kereső)" },
    ],
  },
  {
    group: "Fizetős API kulccsal",
    items: [
      { value: "google_places", label: "Google Maps (Places API)" },
      { value: "serper", label: "Google Maps (Serper.dev)" },
    ],
  },
];

export function sourceLabel(src: string): string {
  switch (src) {
    case "smart_hybrid":
      return "Okos Hibrid";
    case "duckduckgo":
      return "DuckDuckGo / DDGS";
    case "gmaps_scraper":
      return "Google Maps Scraper";
    case "ai_cli_search":
      return "CLI Webkereső";
    case "searxng":
      return "SearXNG";
    case "google_places":
      return "Google Places API";
    case "serper":
      return "Serper Maps";
    default:
      return "OpenStreetMap";
  }
}

export function SearchesPage({
  projects,
  searches,
  leads,
  activeSearchId,
  runningSearchIds,
  enrichingLeadIds,
  liveLogsBySearch,
  liveActiveWorkersBySearch,
  onSelectSearchId,
  onSelectLead,
  onEnrichLeads,
  onRefresh,
  onCreateCampaignFromSearch,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  const [detailTab, setDetailTab] = useState<string>("live");
  const [leadSubFilter, setLeadSubFilter] = useState<string>("all");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiReasoning, setAiReasoning] = useState("");

  const [form, setForm] = useState({
    id: null as string | null,
    projectId: projects[0]?.id || "",
    offerId: "" as string,
    name: "",
    query: "",
    industry: "",
    location: "Budapest",
    companySize: "11-50",
    targetProblem: "",
    source: "smart_hybrid",
    maxResults: 15,
    autoAudit: true,
    autoEnrichThreshold: 70,
  });

  const [importForm, setImportForm] = useState({
    searchId: "" as string,
    rawLines: "",
    runAudit: true,
  });

  const activeSearch = searches.find((s) => s.id === activeSearchId) ?? null;

  // Sync inline edit form only when the user switches to a different search ID
  useEffect(() => {
    if (activeSearch && !modalOpen) {
      setForm({
        id: activeSearch.id,
        projectId: activeSearch.projectId,
        offerId: activeSearch.offerId || "",
        name: activeSearch.name,
        query: activeSearch.query,
        industry: activeSearch.industry,
        location: activeSearch.location,
        companySize: activeSearch.companySize,
        targetProblem: activeSearch.targetProblem,
        source: activeSearch.source,
        maxResults: activeSearch.maxResults,
        autoAudit: activeSearch.autoAudit,
        autoEnrichThreshold: activeSearch.autoEnrichThreshold,
      });
      setAiReasoning("");
      setAiInstruction("");
    }
  }, [activeSearch?.id]);

  const searchLeads = useMemo(() => {
    if (!activeSearch) return [];
    const list = leads.filter((l) => l.searches.some((sp) => sp.searchId === activeSearch.id));
    return list.filter((l) => {
      if (leadSubFilter === "deep") return l.enriched || l.fitScore >= activeSearch.autoEnrichThreshold;
      if (leadSubFilter === "email") return !!l.primaryEmail.trim();
      if (leadSubFilter === "pending") return !l.enriched;
      return true;
    });
  }, [leads, activeSearch, leadSubFilter]);

  const totalSearchLeads = useMemo(() => {
    if (!activeSearch) return [];
    return leads.filter((l) => l.searches.some((sp) => sp.searchId === activeSearch.id));
  }, [leads, activeSearch]);

  const openCreateModal = () => {
    const firstProj = projects[0];
    setForm({
      id: null,
      projectId: firstProj?.id || "",
      offerId: firstProj?.offers[0]?.id || "",
      name: "",
      query: "",
      industry: "",
      location: "Budapest",
      companySize: "11-50",
      targetProblem: "",
      source: "smart_hybrid",
      maxResults: 15,
      autoAudit: true,
      autoEnrichThreshold: 70,
    });
    setAiInstruction("");
    setAiReasoning("");
    setModalOpen(true);
  };

  const handleSave = async (closeModalAfter = true) => {
    if (!form.projectId) {
      notifications.show({
        title: "Projekt szükséges",
        message: "Előbb hozz létre egy projektet a Projektek menüben!",
        color: "orange",
      });
      return;
    }
    if (!form.name.trim() || !form.query.trim()) {
      notifications.show({
        title: "Hiányzó mezők",
        message: "Add meg a keresés nevét és a cél kulcsszót!",
        color: "red",
      });
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveSearch({
        id: form.id,
        projectId: form.projectId,
        offerId: form.offerId || null,
        name: form.name.trim(),
        query: form.query.trim(),
        industry: form.industry.trim() || form.query.trim(),
        location: form.location.trim(),
        companySize: form.companySize,
        targetProblem: form.targetProblem.trim(),
        source: form.source,
        maxResults: form.maxResults,
        autoAudit: form.autoAudit,
        autoEnrichThreshold: form.autoEnrichThreshold,
      });
      await onRefresh();
      if (closeModalAfter) {
        setModalOpen(false);
        onSelectSearchId(saved.id);
      }
      notifications.show({ title: "Keresés mentve", message: saved.name, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const handleAiOptimize = async () => {
    if (!form.projectId) {
      notifications.show({
        title: "Projekt szükséges",
        message: "Válassz projektet az AI keresés-optimalizáláshoz!",
        color: "orange",
      });
      return;
    }
    setOptimizing(true);
    try {
      const res = await api.optimizeSearchWithAi(
        {
          id: form.id,
          projectId: form.projectId,
          offerId: form.offerId || null,
          name: form.name,
          query: form.query,
          industry: form.industry,
          location: form.location,
          companySize: form.companySize,
          targetProblem: form.targetProblem,
          source: form.source,
          maxResults: form.maxResults,
          autoAudit: form.autoAudit,
          autoEnrichThreshold: form.autoEnrichThreshold,
        },
        aiInstruction
      );
      setForm((prev) => ({
        ...prev,
        name: res.name || prev.name,
        query: res.query || prev.query,
        industry: res.industry || prev.industry,
        location: res.location || prev.location,
        companySize: res.companySize || prev.companySize,
        targetProblem: res.targetProblem || prev.targetProblem,
        source: res.source || prev.source,
        maxResults: res.maxResults || prev.maxResults,
        autoEnrichThreshold: res.autoEnrichThreshold || prev.autoEnrichThreshold,
        offerId: res.offerId || prev.offerId,
      }));
      setAiReasoning(
        res.aiError ? `⚠ AI modell nem válaszolt (${res.aiError}) — ${res.reasoning}` : res.reasoning
      );
      notifications.show({
        title: res.aiError
          ? "Az AI modell nem adott választ (alap optimalizáló futott)"
          : "AI optimalizálta a keresést",
        message: res.aiError
          ? res.aiError
          : "Átnézheted a módosított mezőket, majd kattints a Mentésre!",
        color: res.aiError ? "orange" : "forest",
      });
    } catch (e) {
      notifications.show({ title: "AI hiba", message: String(e), color: "red" });
    } finally {
      setOptimizing(false);
    }
  };

  const handleStart = async (s: SearchJob, continuous: boolean) => {
    onSelectSearchId(s.id);
    setDetailTab("live");
    try {
      await api.startSearchJob(s.id, continuous);
      await onRefresh();
      notifications.show({
        title: continuous ? "Folyamatos keresés elindítva" : "Keresés elindítva",
        message: continuous
          ? `${s.name} — 5-ös párhuzamos adagokban fut, amíg le nem állítod.`
          : `${s.name} — 5-ös párhuzamos adagokban fut.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Indítási hiba", message: String(e), color: "red" });
    }
  };

  const handleStop = async (searchId: string) => {
    try {
      await api.stopSearchJob(searchId);
      await onRefresh();
      notifications.show({
        title: "Keresés leállítva",
        message: "A keresés azonnal leállt, bármikor újraindítható.",
        color: "orange",
      });
    } catch (e) {
      notifications.show({ title: "Leállítási hiba", message: String(e), color: "red" });
    }
  };

  const handleDeepEnrichSingle = (lead: Lead) => {
    onEnrichLeads([lead.id], activeSearch?.projectId || projects[0]?.id || null);
  };

  const handleImport = async () => {
    if (!importForm.rawLines.trim()) return;
    setSaving(true);
    try {
      const count = await api.importManualLeads(
        importForm.searchId || activeSearch?.id || null,
        importForm.rawLines,
        importForm.runAudit
      );
      await onRefresh();
      setImportModalOpen(false);
      setImportForm({ searchId: "", rawLines: "", runAudit: true });
      notifications.show({
        title: "Importálás sikeres",
        message: `${count} cég hozzáadva a központi adatbázishoz.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Import hiba", message: String(e), color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSearch(id);
      if (activeSearchId === id) onSelectSearchId(null);
      await onRefresh();
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  // ==================== DETAIL WORKSPACE VIEW ====================
  if (activeSearch) {
    const logs = liveLogsBySearch[activeSearch.id] || [];
    const activeWorkersMap = liveActiveWorkersBySearch[activeSearch.id] || {};
    const activeWorkers = Object.values(activeWorkersMap);
    const latestEvent = logs[logs.length - 1];
    const isRunning =
      runningSearchIds.includes(activeSearch.id) || activeSearch.status === "running";
    const pct =
      latestEvent && latestEvent.total > 0
        ? Math.min(100, (latestEvent.current / latestEvent.total) * 100)
        : 0;

    const deepCount = totalSearchLeads.filter(
      (l) => l.enriched || l.fitScore >= activeSearch.autoEnrichThreshold
    ).length;
    const emailCount = totalSearchLeads.filter((l) => !!l.primaryEmail.trim()).length;
    const avgFit =
      totalSearchLeads.length > 0
        ? totalSearchLeads.reduce((a, b) => a + b.fitScore, 0) / totalSearchLeads.length
        : 0;

    return (
      <Box>
        <Box className="ml-page-header">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Box>
              <Group gap={8} mb={4}>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconArrowLeft size={13} />}
                  onClick={() => onSelectSearchId(null)}
                >
                  Összes keresés
                </Button>
                <Badge size="xs" variant="default">
                  {sourceLabel(activeSearch.source)}
                </Badge>
                <Badge
                  size="xs"
                  color={
                    isRunning
                      ? "blue"
                      : activeSearch.status === "completed"
                      ? "green"
                      : activeSearch.status === "failed"
                      ? "red"
                      : "gray"
                  }
                >
                  {isRunning
                    ? "Élőben fut..."
                    : activeSearch.status === "completed"
                    ? "Befejezve"
                    : activeSearch.status === "failed"
                    ? "Hiba"
                    : "Tervezet"}
                </Badge>
              </Group>
              <Title order={3} style={{ letterSpacing: "-0.02em" }}>
                {activeSearch.name}
              </Title>
              <Text size="xs" c="dimmed" mt={2}>
                Projekt: <strong>{activeSearch.projectName}</strong> • Ajánlat:{" "}
                <strong>{activeSearch.offerTitle || "Alap"}</strong> • Kulcsszó:{" "}
                <span className="ml-mono">{activeSearch.query}</span> ({activeSearch.location || "Országos"})
              </Text>
            </Box>

            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconEdit size={14} />}
                onClick={() => setDetailTab("settings")}
              >
                Szerkesztés & AI fix
              </Button>
              <Button
                variant="default"
                leftSection={<IconSend size={14} />}
                disabled={totalSearchLeads.length === 0}
                onClick={() => onCreateCampaignFromSearch(activeSearch)}
              >
                Kampány indítása
              </Button>
              {isRunning ? (
                <Button
                  color="red"
                  leftSection={<IconPlayerStop size={14} />}
                  onClick={() => handleStop(activeSearch.id)}
                >
                  Leállítás (Stop)
                </Button>
              ) : (
                <>
                  <Button
                    variant="default"
                    leftSection={<IconPlayerPlay size={14} />}
                    onClick={() => handleStart(activeSearch, false)}
                  >
                    Futtatás (5-ösével)
                  </Button>
                  <Button
                    leftSection={<IconInfinity size={15} />}
                    onClick={() => handleStart(activeSearch, true)}
                  >
                    Folyamatos (Stop-ig)
                  </Button>
                </>
              )}
            </Group>
          </Group>
        </Box>

        <Box className="ml-page-body">
          <Stack gap="md">
            {/* KPI Summary Strip for this Search */}
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Talált cégek</Text>
                <Text size="xl" fw={700} className="ml-tabular">
                  {totalSearchLeads.length}
                </Text>
                <Text size="xs" c="dimmed">
                  Max keret: {activeSearch.maxResults}
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Ígéretes / Mélyen kutatott</Text>
                <Text size="xl" fw={700} c="forest.9" className="ml-tabular">
                  {deepCount}
                </Text>
                <Text size="xs" c="dimmed">
                  Küszöb: Fit ≥ {activeSearch.autoEnrichThreshold}
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Kinyert e-maillel</Text>
                <Text size="xl" fw={700} className="ml-tabular">
                  {emailCount}
                </Text>
                <Text size="xs" c="dimmed">
                  Azonnal kampányolható
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Átlag Fit Score</Text>
                <Text size="xl" fw={700} className="ml-tabular">
                  {avgFit.toFixed(1)}
                </Text>
                <Text size="xs" c="dimmed">
                  Utolsó futás: {formatShortDate(activeSearch.lastRunAt)}
                </Text>
              </Box>
            </SimpleGrid>

            {/* REALTIME LIVE MONITOR PANEL (always visible when running or logs exist) */}
            {(isRunning || logs.length > 0 || activeSearch.lastError) && (
              <Paper
                p="md"
                style={{
                  borderColor: isRunning ? "#166534" : undefined,
                }}
              >
                <Group justify="space-between" mb={8}>
                  <Group gap={8}>
                    {isRunning && <Loader size={14} color="forest" />}
                    <Text size="sm" fw={600}>
                      Valós idejű kutatási folyamat
                    </Text>
                    {latestEvent && latestEvent.continuous && (
                      <Badge size="xs" color="forest" variant="filled">
                        Folyamatos mód (Stop-ig)
                      </Badge>
                    )}
                    {latestEvent && latestEvent.round > 0 && (
                      <Badge size="xs" variant="default" className="ml-tabular">
                        Kör #{latestEvent.round} • Adag #{latestEvent.batch} (5-ösével)
                      </Badge>
                    )}
                    {latestEvent && (
                      <Badge size="xs" color={isRunning ? "blue" : latestEvent.phase === "failed" ? "red" : latestEvent.phase === "stopped" ? "orange" : "green"}>
                        {latestEvent.phase === "discovering"
                          ? "Források keresése"
                          : latestEvent.phase === "merging"
                          ? "Összefésülés & szűrés"
                          : latestEvent.phase === "batch_start"
                          ? "Új 5-ös adag indul"
                          : latestEvent.phase === "auditing"
                          ? "Weboldalak vizsgálata"
                          : latestEvent.phase === "deep_enriching"
                          ? "Mélyebb kutatás (5 aloldal)"
                          : latestEvent.phase === "stopped"
                          ? "Leállítva"
                          : latestEvent.phase === "completed"
                          ? "Kész"
                          : latestEvent.phase === "failed"
                          ? "Hiba"
                          : "Feldolgozás"}
                      </Badge>
                    )}
                  </Group>
                  {latestEvent && latestEvent.total > 0 && (
                    <Text size="xs" fw={600} className="ml-tabular">
                      {latestEvent.current} / {latestEvent.total} cég
                    </Text>
                  )}
                </Group>

                {isRunning && (
                  <Progress
                    value={pct > 0 ? pct : 100}
                    animated={pct === 0}
                    color="forest"
                    size="sm"
                    mb="sm"
                  />
                )}

                {activeSearch.lastError && !isRunning && (
                  <Text size="xs" c="red" mb="xs">
                    Utolsó hiba: {activeSearch.lastError}
                  </Text>
                )}

                {/* Currently Active Parallel Workers ("ki az akit kutat épp most + hányadik aloldalt!") */}
                {activeWorkers.length > 0 && (
                  <Box mb="sm">
                    <Group justify="space-between" mb={6}>
                      <Text className="ml-section-label">
                        Épp most vizsgált weboldalak ({activeWorkers.length} párhuzamos szál)
                      </Text>
                      <Text size="11px" c="forest.9" fw={600}>
                        {activeWorkers.filter((w) => w.phase === "deep_enriching").length} mély
                        kutatás • {activeWorkers.filter((w) => w.phase === "auditing").length} alap
                        audit
                      </Text>
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
                      {activeWorkers.map((w, i) => {
                        const pgCur = w.pagesCrawled ?? 1;
                        const pgTot = w.pagesTotal ?? (w.phase === "deep_enriching" ? 6 : 3);
                        const subPct = Math.min(100, Math.round((pgCur / Math.max(pgTot, 1)) * 100));
                        const shortPath = (() => {
                          if (!w.currentUrl) return w.domain || "";
                          try {
                            const u = new URL(w.currentUrl);
                            return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
                          } catch {
                            return w.currentUrl;
                          }
                        })();
                        return (
                          <Paper
                            key={w.leadId || i}
                            p="xs"
                            style={{
                              backgroundColor: "var(--ml-canvas)",
                              borderColor: w.phase === "deep_enriching" ? "#166534" : undefined,
                            }}
                          >
                            <Group justify="space-between" wrap="nowrap" mb={4}>
                              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                                <Loader size={12} color="forest" />
                                <Text size="xs" fw={600} truncate>
                                  {w.companyName || "Cég"}
                                </Text>
                              </Group>
                              <Badge
                                size="xs"
                                color={w.phase === "deep_enriching" ? "forest" : "blue"}
                                variant={w.phase === "deep_enriching" ? "filled" : "light"}
                                className="ml-tabular"
                              >
                                {w.phase === "deep_enriching"
                                  ? `Mély kutatás ${pgCur}/${pgTot}`
                                  : `Audit ${pgCur}/${pgTot}`}
                              </Badge>
                            </Group>
                            <Progress
                              value={subPct}
                              size={4}
                              color={w.phase === "deep_enriching" ? "forest" : "blue"}
                              mb={4}
                            />
                            <Text size="11px" c="dimmed" className="ml-mono" truncate>
                              {shortPath || w.message}
                            </Text>
                          </Paper>
                        );
                      })}
                    </SimpleGrid>
                  </Box>
                )}

                {/* Timestamped Live Activity Log */}
                {logs.length > 0 && (
                  <Box>
                    <Text className="ml-section-label" mb={4}>
                      Élő napló ({logs.length} esemény)
                    </Text>
                    <ScrollArea
                      h={130}
                      style={{
                        backgroundColor: "var(--ml-canvas)",
                        border: "1px solid var(--ml-border)",
                        borderRadius: 5,
                        padding: "6px 10px",
                      }}
                    >
                      <Stack gap={3}>
                        {[...logs].reverse().map((ev, idx) => (
                          <Group key={idx} gap={8} wrap="nowrap" align="flex-start">
                            <Text size="11px" c="dimmed" className="ml-mono" style={{ whiteSpace: "nowrap" }}>
                              {new Date(ev.timestamp).toLocaleTimeString("hu-HU")}
                            </Text>
                            <Text
                              size="11.5px"
                              className="ml-mono"
                              c={
                                ev.phase === "failed"
                                  ? "red"
                                  : ev.phase === "deep_enriching" || ev.phase === "completed"
                                  ? "forest.9"
                                  : undefined
                              }
                            >
                              {ev.message}
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                    </ScrollArea>
                  </Box>
                )}
              </Paper>
            )}

            <Tabs value={detailTab} onChange={(v) => setDetailTab(v || "live")}>
              <Tabs.List mb="md">
                <Tabs.Tab value="live">
                  Talált leadek ({totalSearchLeads.length})
                </Tabs.Tab>
                <Tabs.Tab value="settings" leftSection={<IconAdjustments size={14} />}>
                  Keresés szerkesztése & AI optimalizáló
                </Tabs.Tab>
              </Tabs.List>

              {/* Tab 1: Search Leads Table */}
              <Tabs.Panel value="live">
                <Stack gap="sm">
                  <Group justify="space-between" wrap="wrap">
                    <SegmentedControl
                      size="xs"
                      value={leadSubFilter}
                      onChange={setLeadSubFilter}
                      data={[
                        { value: "all", label: `Összes (${totalSearchLeads.length})` },
                        { value: "deep", label: `Ígéretes / Mélyen kutatott (${deepCount})` },
                        { value: "email", label: `E-maillel (${emailCount})` },
                        {
                          value: "pending",
                          label: `Még nincs mély dosszié (${totalSearchLeads.length - totalSearchLeads.filter((l) => l.enriched).length})`,
                        },
                      ]}
                    />
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconUpload size={13} />}
                      onClick={() => {
                        setImportForm({ searchId: activeSearch.id, rawLines: "", runAudit: true });
                        setImportModalOpen(true);
                      }}
                    >
                      + Weboldalak hozzáadása ehhez a kereséshez
                    </Button>
                  </Group>

                  <Paper>
                    {searchLeads.length === 0 ? (
                      <Box p="xl" ta="center">
                        <Text size="sm" c="dimmed">
                          {totalSearchLeads.length === 0
                            ? "Még nincsenek találatok. Kattints a „Keresés futtatása” gombra!"
                            : "Nincs a szűrőnek megfelelő cég."}
                        </Text>
                      </Box>
                    ) : (
                      <Table>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Cég & Weboldal</Table.Th>
                            <Table.Th>Kutatási mélység</Table.Th>
                            <Table.Th>E-mail & Létszám</Table.Th>
                            <Table.Th>Feltárt probléma / Segítség</Table.Th>
                            <Table.Th ta="center">Fit</Table.Th>
                            <Table.Th>Státusz</Table.Th>
                            <Table.Th ta="right">Művelet</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {searchLeads.map((l) => {
                            const worker = activeWorkersMap[l.id];
                            const meta = LEAD_STATUS_META[l.status] ?? {
                              label: l.status,
                              color: "gray",
                            };
                            const isNewUnaudited = !l.audit && l.fitScore === 0;
                            const scoreClass =
                              l.fitScore >= 75
                                ? "ml-score-high"
                                : l.fitScore >= 55
                                ? "ml-score-mid"
                                : "ml-score-low";
                            return (
                              <Table.Tr
                                key={l.id}
                                style={{ cursor: "pointer" }}
                                onClick={() => onSelectLead(l)}
                              >
                                <Table.Td>
                                  <Text size="sm" fw={600}>
                                    {l.companyName}
                                  </Text>
                                  <Text size="xs" c="dimmed" className="ml-mono">
                                    {l.domain || "nincs weboldal"} • {l.source}
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  {worker ? (
                                    <Badge
                                      size="xs"
                                      color={worker.phase === "deep_enriching" ? "forest" : "blue"}
                                      variant="filled"
                                      leftSection={<Loader size={10} color="white" />}
                                    >
                                      {worker.phase === "deep_enriching"
                                        ? `Mély kutatás (${worker.pagesCrawled ?? 1}/${worker.pagesTotal ?? 6} oldal)`
                                        : `Audit (${worker.pagesCrawled ?? 1}/${worker.pagesTotal ?? 3} oldal)`}
                                    </Badge>
                                  ) : l.enriched ? (
                                    <Badge size="xs" color="forest" variant="filled">
                                      Mély dosszié ({l.audit?.pagesCrawled || 5} oldal)
                                    </Badge>
                                  ) : l.audit ? (
                                    <Badge size="xs" variant="default">
                                      Alap audit ({l.audit.pagesCrawled} oldal)
                                    </Badge>
                                  ) : (
                                    <Badge size="xs" color="gray" variant="outline">
                                      Új (auditra vár)
                                    </Badge>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  <Text size="xs" className="ml-mono">
                                    {l.primaryEmail || "—"}
                                  </Text>
                                  <Text size="11px" c="dimmed">
                                    {l.employeeEstimate || "—"}
                                  </Text>
                                </Table.Td>
                                <Table.Td maw={260}>
                                  <Text size="xs" lineClamp={2} c={isNewUnaudited ? "dimmed" : undefined}>
                                    {l.painPoints[0] ||
                                      l.companySummary ||
                                      (isNewUnaudited ? "Még nem vizsgált új cég" : "—")}
                                  </Text>
                                </Table.Td>
                                <Table.Td ta="center">
                                  {isNewUnaudited ? (
                                    <Text size="xs" c="dimmed">
                                      —
                                    </Text>
                                  ) : (
                                    <span className={`ml-score-pill ${scoreClass}`}>
                                      {l.fitScore}
                                    </span>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  <Badge size="xs" color={meta.color}>
                                    {isNewUnaudited ? "Új" : meta.label}
                                  </Badge>
                                </Table.Td>
                                <Table.Td ta="right" onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      size="compact-xs"
                                      variant={isNewUnaudited ? "filled" : "default"}
                                      leftSection={<IconRefresh size={12} />}
                                      loading={enrichingLeadIds.includes(l.id) || !!worker}
                                      onClick={() => handleDeepEnrichSingle(l)}
                                    >
                                      {isNewUnaudited ? "Audit" : "Mély kutatás"}
                                    </Button>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    )}
                  </Paper>
                </Stack>
              </Tabs.Panel>

              {/* Tab 2: Inline Full Search Editor + AI Search Optimizer */}
              <Tabs.Panel value="settings">
                <Stack gap="md" maw={860}>
                  {/* AI Search Fixer / Optimizer Box */}
                  <Paper p="md" style={{ backgroundColor: "var(--ml-canvas)" }}>
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>
                        AI Keresés-optimalizáló (Fixálja és beállítja a keresést)
                      </Text>
                      <Text size="xs" c="dimmed">
                        Írd le szabadon, mit szeretnél javítani vagy finomítani (vagy hagyd üresen),
                        és az AI a projekted + ajánlataid alapján pontosítja a kulcsszót, a keresett
                        problémát, a cégméretet és a legjobb keresőmotort.
                      </Text>
                      <Group align="flex-end" gap="xs">
                        <TextInput
                          placeholder="pl. Keressünk 15+ fős vidéki klinikákat, akiknél elavult a mobil nézet és nincs online foglalás..."
                          value={aiInstruction}
                          onChange={(e) => setAiInstruction(e.currentTarget.value)}
                          style={{ flex: 1 }}
                        />
                        <Button
                          leftSection={<IconAdjustments size={15} />}
                          loading={optimizing}
                          onClick={handleAiOptimize}
                        >
                          AI állítsa be / fixálja
                        </Button>
                      </Group>
                      {aiReasoning && (
                        <Paper p="xs" mt={4}>
                          <Text size="xs" fw={600} c="forest.9">
                            AI indoklás:
                          </Text>
                          <Text size="xs" mt={2}>
                            {aiReasoning}
                          </Text>
                        </Paper>
                      )}
                    </Stack>
                  </Paper>

                  {/* Full Editable Form */}
                  <Paper p="md">
                    <Stack gap="sm">
                      <TextInput
                        label="Keresés neve"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
                      />
                      <Select
                        label="Projekt"
                        value={form.projectId}
                        onChange={(v) => setForm({ ...form, projectId: v || "", offerId: "" })}
                        data={projects.map((p) => ({ value: p.id, label: p.name }))}
                      />

                      <SimpleGrid cols={3}>
                        <TextInput
                          label="Kulcsszó / Téma"
                          required
                          value={form.query}
                          onChange={(e) => setForm({ ...form, query: e.currentTarget.value })}
                        />
                        <TextInput
                          label="Város / Régió"
                          value={form.location}
                          onChange={(e) => setForm({ ...form, location: e.currentTarget.value })}
                        />
                        <Select
                          label="Cégméret (fő)"
                          value={form.companySize}
                          onChange={(v) => setForm({ ...form, companySize: v || "any" })}
                          data={[
                            { value: "any", label: "Bármilyen méret" },
                            { value: "1-10", label: "1–10 fő" },
                            { value: "11-50", label: "11–50 fő" },
                            { value: "51-200", label: "51–200 fő" },
                            { value: "200+", label: "200+ fő" },
                          ]}
                        />
                      </SimpleGrid>

                      <Textarea
                        label="Keresett probléma / audit szempont"
                        minRows={3}
                        value={form.targetProblem}
                        onChange={(e) =>
                          setForm({ ...form, targetProblem: e.currentTarget.value })
                        }
                      />

                      <SimpleGrid cols={3}>
                        <Select
                          label="Keresőmotor"
                          value={form.source}
                          onChange={(v) => setForm({ ...form, source: v || "smart_hybrid" })}
                          data={SOURCE_SELECT_DATA}
                        />
                        <NumberInput
                          label="Max találat"
                          min={1}
                          value={form.maxResults}
                          onChange={(v) => setForm({ ...form, maxResults: Number(v) || 15 })}
                        />
                        <NumberInput
                          label="Mély kutatás Fit küszöb"
                          min={10}
                          max={95}
                          value={form.autoEnrichThreshold}
                          onChange={(v) =>
                            setForm({ ...form, autoEnrichThreshold: Number(v) || 70 })
                          }
                        />
                      </SimpleGrid>

                      <Switch
                        label="Automatikus weboldal-audit + mélyebb 5-oldalas kutatás a küszöb feletti cégekre"
                        checked={form.autoAudit}
                        onChange={(e) =>
                          setForm({ ...form, autoAudit: e.currentTarget.checked })
                        }
                      />

                      <Divider />
                      <Group justify="space-between">
                        <Button
                          variant="subtle"
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => handleDelete(activeSearch.id)}
                        >
                          Keresés törlése
                        </Button>
                        <Group gap="xs">
                          <Button
                            leftSection={<IconCheck size={15} />}
                            loading={saving}
                            onClick={() => handleSave(false)}
                          >
                            Módosítások mentése
                          </Button>
                          <Button
                            variant="default"
                            leftSection={<IconPlayerPlay size={14} />}
                            disabled={isRunning}
                            onClick={async () => {
                              await handleSave(false);
                              await handleStart(activeSearch, false);
                            }}
                          >
                            Mentés & Futtatás
                          </Button>
                          <Button
                            leftSection={<IconInfinity size={15} />}
                            disabled={isRunning}
                            onClick={async () => {
                              await handleSave(false);
                              await handleStart(activeSearch, true);
                            }}
                          >
                            Mentés & Folyamatos
                          </Button>
                        </Group>
                      </Group>
                    </Stack>
                  </Paper>
                </Stack>
              </Tabs.Panel>
            </Tabs>
          </Stack>
        </Box>
      </Box>
    );
  }

  // ==================== MASTER SEARCHES LIST VIEW ====================
  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Keresések (Lead Discovery)
            </Title>
            <Text size="sm" c="dimmed">
              Kattints bármelyik keresésre a részletes élő munkaterület, találatok és szerkesztő
              megnyitásához.
            </Text>
          </Box>
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconUpload size={15} />}
              onClick={() => setImportModalOpen(true)}
            >
              Weboldal lista / CSV import
            </Button>
            <Button leftSection={<IconPlus size={15} />} onClick={openCreateModal}>
              Új keresés
            </Button>
          </Group>
        </Group>
      </Box>

      <Box className="ml-page-body">
        {searches.length === 0 ? (
          <Paper p="xl">
            <Stack gap="sm" maw={560}>
              <Title order={4}>Még nincs mentett keresés</Title>
              <Text size="sm" c="dimmed">
                Hozz létre egy keresést kézzel, használd az AI Keresés-optimalizálót, vagy szólj a
                Központi Asszisztensnek (⌘K), hogy állítsa össze és indítsa el neked!
              </Text>
              <Group>
                <Button leftSection={<IconPlus size={15} />} onClick={openCreateModal}>
                  Első keresés létrehozása
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Paper>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Keresés neve & célprobléma</Table.Th>
                  <Table.Th>Projekt</Table.Th>
                  <Table.Th>Célzás</Table.Th>
                  <Table.Th>Motor</Table.Th>
                  <Table.Th ta="right">Találatok</Table.Th>
                  <Table.Th>Státusz</Table.Th>
                  <Table.Th ta="right">Műveletek</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {searches.map((s) => (
                  <Table.Tr
                    key={s.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setDetailTab("live");
                      onSelectSearchId(s.id);
                    }}
                  >
                    <Table.Td maw={300}>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={600}>
                          {s.name}
                        </Text>
                        <IconChevronRight size={14} style={{ opacity: 0.45 }} />
                      </Group>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {s.targetProblem || `Kulcsszó: ${s.query}`}
                      </Text>
                      {s.lastError && (
                        <Text size="xs" c="red" mt={2}>
                          Hiba: {s.lastError}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={600}>
                        {s.projectName}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {s.location || "Országos"} • {s.companySize} fő
                      </Text>
                      <Text size="11px" c="dimmed">
                        Mély kutatás: Fit ≥ {s.autoEnrichThreshold}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="default">
                        {sourceLabel(s.source)}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600} className="ml-tabular">
                        {s.leadsFound} cég
                      </Text>
                      <Text size="11px" c="forest.9" className="ml-tabular">
                        {s.promisingCount} ígéretes
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={
                          s.status === "completed"
                            ? "green"
                            : s.status === "running"
                            ? "blue"
                            : s.status === "failed"
                            ? "red"
                            : "gray"
                        }
                      >
                        {s.status === "completed"
                          ? "Kész"
                          : s.status === "running"
                          ? "Fut..."
                          : s.status === "failed"
                          ? "Hiba"
                          : "Tervezet"}
                      </Badge>
                      <Text size="10px" c="dimmed" mt={2}>
                        {formatShortDate(s.lastRunAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <Group justify="flex-end" gap={6} wrap="nowrap">
                        {runningSearchIds.includes(s.id) || s.status === "running" ? (
                          <Button
                            size="xs"
                            color="red"
                            leftSection={<IconPlayerStop size={13} />}
                            onClick={() => handleStop(s.id)}
                          >
                            Stop
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="xs"
                              variant="default"
                              leftSection={<IconPlayerPlay size={13} />}
                              onClick={() => handleStart(s, false)}
                            >
                              Futtatás
                            </Button>
                            <Button
                              size="xs"
                              variant="filled"
                              leftSection={<IconInfinity size={13} />}
                              onClick={() => handleStart(s, true)}
                            >
                              Folyamatos
                            </Button>
                          </>
                        )}
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => {
                            setDetailTab("live");
                            onSelectSearchId(s.id);
                          }}
                        >
                          Megnyitás
                        </Button>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          title="Szerkesztés & AI optimalizáló"
                          onClick={() => {
                            setDetailTab("settings");
                            onSelectSearchId(s.id);
                          }}
                        >
                          <IconEdit size={14} />
                        </ActionIcon>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          title="Törlés"
                          onClick={() => handleDelete(s.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Box>

      {/* New Search Modal (with built-in AI Setup helper!) */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Új célcsoport keresés létrehozása"
        size="lg"
      >
        <Stack gap="sm">
          <Paper p="sm" style={{ backgroundColor: "var(--ml-canvas)" }}>
            <Text size="xs" fw={600} mb={4}>
              AI Keresés-beállító (opcionális)
            </Text>
            <Group gap="xs" align="flex-end">
              <TextInput
                size="xs"
                placeholder="Írd le röviden, kiket keressünk (pl. győri autószervizek online foglalás nélkül)..."
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                variant="default"
                leftSection={<IconAdjustments size={13} />}
                loading={optimizing}
                onClick={handleAiOptimize}
              >
                AI kitölti
              </Button>
            </Group>
            {aiReasoning && (
              <Text size="11px" c="forest.9" mt={6}>
                {aiReasoning}
              </Text>
            )}
          </Paper>

          <TextInput
            label="Keresés neve"
            placeholder="pl. Budapesti fogászatok — online foglaló nélkül"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />

          <Select
            label="Melyik projektedhez?"
            required
            value={form.projectId}
            onChange={(v) => setForm({ ...form, projectId: v || "", offerId: "" })}
            data={projects.map((p) => ({ value: p.id, label: p.name }))}
          />

          <SimpleGrid cols={3}>
            <TextInput
              label="Téma / Keresőszó"
              placeholder="pl. fogászati klinika, ügyvéd"
              required
              value={form.query}
              onChange={(e) => setForm({ ...form, query: e.currentTarget.value })}
            />
            <TextInput
              label="Város / Régió"
              placeholder="pl. Budapest, Győr"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.currentTarget.value })}
            />
            <Select
              label="Cégméret (fő)"
              value={form.companySize}
              onChange={(v) => setForm({ ...form, companySize: v || "any" })}
              data={[
                { value: "any", label: "Bármilyen méret" },
                { value: "1-10", label: "1–10 fő" },
                { value: "11-50", label: "11–50 fő" },
                { value: "51-200", label: "51–200 fő" },
                { value: "200+", label: "200+ fő" },
              ]}
            />
          </SimpleGrid>

          <Textarea
            label="Milyen problémára / hiányosságra keressen a weboldalukon?"
            placeholder="pl. Nincs online időpontfoglaló, elavult mobil nézet, nincs élő chat..."
            minRows={2}
            value={form.targetProblem}
            onChange={(e) => setForm({ ...form, targetProblem: e.currentTarget.value })}
          />

          <SimpleGrid cols={3}>
            <Select
              label="Keresőmotor / Adatforrás"
              value={form.source}
              onChange={(v) => setForm({ ...form, source: v || "smart_hybrid" })}
              data={SOURCE_SELECT_DATA}
            />
            <NumberInput
              label="Max találat"
              min={1}
              value={form.maxResults}
              onChange={(v) => setForm({ ...form, maxResults: Number(v) || 15 })}
            />
            <NumberInput
              label="Mély kutatás Fit küszöb"
              min={10}
              max={95}
              value={form.autoEnrichThreshold}
              onChange={(v) => setForm({ ...form, autoEnrichThreshold: Number(v) || 70 })}
            />
          </SimpleGrid>

          <Switch
            label="Automatikus weboldal-audit + mélyebb kutatás az ígéretes cégekre"
            checked={form.autoAudit}
            onChange={(e) => setForm({ ...form, autoAudit: e.currentTarget.checked })}
          />

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setModalOpen(false)}>
              Mégse
            </Button>
            <Button onClick={() => handleSave(true)} loading={saving}>
              Keresés mentése és megnyitása
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Manual / CSV Import Modal */}
      <Modal
        opened={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Cégek / Weboldalak kézi importálása"
        size="lg"
      >
        <Stack gap="sm">
          <Select
            label="Hozzárendelés kereséshez (opcionális)"
            clearable
            value={importForm.searchId || null}
            onChange={(v) => setImportForm({ ...importForm, searchId: v || "" })}
            data={searches.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Textarea
            label="Soronként egy cég: „Cégnév, https://weboldal.hu, email@ceg.hu” vagy csak „https://weboldal.hu”"
            minRows={6}
            placeholder={"Példa Klinika, https://peldaklinika.hu, info@peldaklinika.hu\nhttps://masikceg.hu"}
            value={importForm.rawLines}
            onChange={(e) => setImportForm({ ...importForm, rawLines: e.currentTarget.value })}
          />
          <Switch
            label="Azonnali weboldal-audit és Fit Score számítás importáláskor"
            checked={importForm.runAudit}
            onChange={(e) => setImportForm({ ...importForm, runAudit: e.currentTarget.checked })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setImportModalOpen(false)}>
              Mégse
            </Button>
            <Button onClick={handleImport} loading={saving}>
              Importálás és feldolgozás
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
