import { useCallback, useEffect, useState } from "react";
import { notifications } from "@mantine/notifications";
import { AddToCampaignModal } from "./components/AddToCampaignModal";
import { AppShellLayout } from "./components/AppShellLayout";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { DirectEmailModal } from "./components/DirectEmailModal";
import { LeadDrawer } from "./components/LeadDrawer";
import { api } from "./lib/api";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InboxPage } from "./pages/InboxPage";
import { LeadsPage } from "./pages/LeadsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SearchesPage } from "./pages/SearchesPage";
import { SettingsPage } from "./pages/SettingsPage";
import type {
  AnalyticsOverview,
  AppSettings,
  Campaign,
  InboxThread,
  JobProgressEvent,
  Lead,
  NavSection,
  Project,
  SearchJob,
  SearchLiveEvent,
  SenderAccount,
  SuppressionEntry,
} from "./types";

const defaultSettings: AppSettings = {
  aiProvider: "openrouter",
  aiApiKey: "",
  aiModel: "openai/gpt-4o-mini",
  aiBaseUrl: "",
  aiCliPath: "",
  googlePlacesApiKey: "",
  serperApiKey: "",
  searxngUrl: "",
  gmapsScraperPath: "",
  cliSearchEngine: "auto",
  defaultLanguage: "hu",
  companySignature: "Üdvözlettel,\nMyLead Csapat",
  imapPollMinutes: 5,
  autoReplyEnabled: true,
  autoReplyWorkdays: [1, 2, 3, 4, 5, 6],
  autoReplyStartHour: 8,
  autoReplyEndHour: 18,
  autoReplyMinDelayMin: 20,
  autoReplyMaxDelayMin: 120,
  autoReplyDefaultDryRun: false,
  aiAnalysisFocus:
    "Fókuszálj konkrétan arra, hogy egy okosűrlap (intelligens, többlépcsős ajánlatkérő / előszűrő / kalkulátor / időpontfoglaló űrlap) mit tehet ennek a cégnek a saját szolgáltatásai alapján.",
  aiReplyInstructions: "",
  defaultTone: "professional_formal",
  defaultDailyLimit: 35,
};

export default function App() {
  const [section, setSection] = useState<NavSection>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [searches, setSearches] = useState<SearchJob[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [senderAccounts, setSenderAccounts] = useState<SenderAccount[]>([]);
  const [suppressions, setSuppressions] = useState<SuppressionEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [leadsSearchFilter, setLeadsSearchFilter] = useState<string | null>(null);
  const [campaignPrefillSearch, setCampaignPrefillSearch] = useState<SearchJob | null>(null);
  const [campaignPrefillLeads, setCampaignPrefillLeads] = useState<string[]>([]);
  const [activeJob, setActiveJob] = useState<JobProgressEvent | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);

  // Realtime search logs, active worker leads & running search IDs
  const [runningSearchIds, setRunningSearchIds] = useState<string[]>([]);
  const [liveLogsBySearch, setLiveLogsBySearch] = useState<Record<string, SearchLiveEvent[]>>({});
  const [liveActiveWorkersBySearch, setLiveActiveWorkersBySearch] = useState<
    Record<string, Record<string, SearchLiveEvent>>
  >({});

  // Global Central AI Assistant drawer (⌘K / Ctrl+K)
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [drawerEmailLead, setDrawerEmailLead] = useState<Lead | null>(null);
  const [drawerAddCampLead, setDrawerAddCampLead] = useState<Lead | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [p, s, l, c, t, sa, sup, cfg, an, running] = await Promise.all([
        api.listProjects(),
        api.listSearches(),
        api.listLeads(),
        api.listCampaigns(),
        api.listInboxThreads(),
        api.listSenderAccounts(),
        api.listSuppressions(),
        api.getSettings(),
        api.getAnalytics(),
        api.listRunningSearches(),
      ]);
      setProjects(p);
      setSearches(s);
      setLeads(l);
      setCampaigns(c);
      setThreads(t);
      setSenderAccounts(sa);
      setSuppressions(sup);
      setSettings(cfg);
      setAnalytics(an);
      setRunningSearchIds(running);
    } catch (err) {
      console.error("Adatbetöltési hiba:", err);
    }
  }, []);

  const refreshLeadsAndSearches = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([api.listSearches(), api.listLeads()]);
      setSearches(s);
      setLeads(l);
    } catch {
      // ignore transient refresh error
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Live refresh when background auto-reply scheduler or IMAP poller updates inbox
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    api
      .onInboxUpdated(() => {
        refreshAll();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshAll]);

  // Global ⌘K / Ctrl+K shortcut for Central Assistant
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAssistantOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Job progress sidebar dock
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    api
      .onJobProgress((ev) => {
        setActiveJob(ev);
        if (clearTimer) clearTimeout(clearTimer);
        if (ev.current >= ev.total) {
          clearTimer = setTimeout(() => setActiveJob(null), 2500);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  // Realtime granular Search Live Events!
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    api
      .onSearchLiveEvent((ev) => {
        if (ev.phase === "starting") {
          setRunningSearchIds((prev) =>
            prev.includes(ev.searchId) ? prev : [...prev, ev.searchId]
          );
        } else if (ev.phase === "completed" || ev.phase === "stopped" || ev.phase === "failed") {
          setRunningSearchIds((prev) => prev.filter((id) => id !== ev.searchId));
        }

        setLiveLogsBySearch((prev) => {
          const existing = ev.phase === "starting" ? [] : prev[ev.searchId] || [];
          return {
            ...prev,
            [ev.searchId]: [...existing.slice(-180), ev],
          };
        });

        setLiveActiveWorkersBySearch((prev) => {
          const currentMap = { ...(prev[ev.searchId] || {}) };
          if (
            ev.phase === "starting" ||
            ev.phase === "completed" ||
            ev.phase === "stopped" ||
            ev.phase === "failed"
          ) {
            return { ...prev, [ev.searchId]: {} };
          }
          if ((ev.phase === "auditing" || ev.phase === "deep_enriching") && ev.leadId) {
            currentMap[ev.leadId] = ev;
            return { ...prev, [ev.searchId]: currentMap };
          }
          if (ev.phase === "lead_done" && ev.leadId) {
            delete currentMap[ev.leadId];
            return { ...prev, [ev.searchId]: currentMap };
          }
          return prev;
        });

        // Live-refresh the leads table as soon as leads are merged or each lead finishes!
        if (
          ev.phase === "merging" ||
          ev.phase === "lead_done" ||
          ev.phase === "completed" ||
          ev.phase === "stopped"
        ) {
          refreshLeadsAndSearches();
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshLeadsAndSearches]);

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      await api.loadDemoData();
      await refreshAll();
      notifications.show({
        title: "Minta munkaterület betöltve",
        message: "FoglaljPro SaaS projekt, 2 keresés, 7 auditált cég és élő levelezések készen állnak.",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Információ", message: String(e), color: "orange" });
    } finally {
      setLoadingDemo(false);
    }
  };

  const unreadInbox = threads.filter((t) => t.hasPendingDraft).length;

  // Flatten all currently active lead research workers across all searches/enrichment jobs
  const activeLeadWorkers: Record<string, SearchLiveEvent> = {};
  for (const map of Object.values(liveActiveWorkersBySearch)) {
    for (const [lid, ev] of Object.entries(map)) {
      activeLeadWorkers[lid] = ev;
    }
  }

  // Keep open LeadDrawer live-synced whenever leads refresh in background!
  const currentSelectedLead = selectedLead
    ? leads.find((l) => l.id === selectedLead.id) || selectedLead
    : null;

  return (
    <>
      <AppShellLayout
        active={section}
        onNavigate={(next) => {
          if (next !== "leads") setLeadsSearchFilter(null);
          if (next !== "searches") setActiveSearchId(null);
          setSection(next);
        }}
        onOpenAssistant={() => setAssistantOpen(true)}
        counts={{
          projects: projects.length,
          searches: searches.length,
          leads: leads.length,
          campaigns: campaigns.length,
          unreadInbox,
        }}
        activeJob={activeJob}
      >
        {section === "dashboard" && (
          <DashboardPage
            analytics={analytics}
            loadingDemo={loadingDemo}
            onLoadDemo={handleLoadDemo}
            onNavigate={setSection}
          />
        )}

        {section === "projects" && (
          <ProjectsPage projects={projects} onRefresh={refreshAll} />
        )}

        {section === "searches" && (
          <SearchesPage
            projects={projects}
            searches={searches}
            leads={leads}
            activeSearchId={activeSearchId}
            runningSearchIds={runningSearchIds}
            liveLogsBySearch={liveLogsBySearch}
            liveActiveWorkersBySearch={liveActiveWorkersBySearch}
            onSelectSearchId={setActiveSearchId}
            onSelectLead={setSelectedLead}
            onRefresh={refreshAll}
            onCreateCampaignFromSearch={(s) => {
              setCampaignPrefillSearch(s);
              setSection("campaigns");
            }}
          />
        )}

        {section === "leads" && (
          <LeadsPage
            key={leadsSearchFilter || "all"}
            leads={leads}
            searches={searches}
            projects={projects}
            campaigns={campaigns}
            senderAccounts={senderAccounts}
            settings={settings}
            initialSearchFilter={leadsSearchFilter}
            activeLeadWorkers={activeLeadWorkers}
            onSelectLead={setSelectedLead}
            onRefresh={refreshAll}
            onCreateCampaignForLeads={(ids) => {
              setCampaignPrefillLeads(ids);
              setSection("campaigns");
            }}
          />
        )}

        {section === "campaigns" && (
          <CampaignsPage
            campaigns={campaigns}
            projects={projects}
            searches={searches}
            senderAccounts={senderAccounts}
            leads={leads}
            prefillSearch={campaignPrefillSearch}
            prefillLeadIds={campaignPrefillLeads}
            onClearPrefill={() => {
              setCampaignPrefillSearch(null);
              setCampaignPrefillLeads([]);
            }}
            onRefresh={refreshAll}
          />
        )}

        {section === "inbox" && (
          <InboxPage
            threads={threads}
            leads={leads}
            projects={projects}
            senderAccounts={senderAccounts}
            settings={settings}
            onSelectLead={setSelectedLead}
            onRefresh={refreshAll}
          />
        )}

        {section === "analytics" && (
          <AnalyticsPage
            analytics={analytics}
            campaigns={campaigns}
            senderAccounts={senderAccounts}
          />
        )}

        {section === "settings" && (
          <SettingsPage
            settings={settings}
            senderAccounts={senderAccounts}
            suppressions={suppressions}
            onRefresh={refreshAll}
          />
        )}
      </AppShellLayout>

      <LeadDrawer
        lead={currentSelectedLead}
        projects={projects}
        liveWorker={currentSelectedLead ? activeLeadWorkers[currentSelectedLead.id] || null : null}
        onClose={() => setSelectedLead(null)}
        onUpdated={(updated) => {
          setSelectedLead(updated);
          refreshAll();
        }}
        onDeleted={() => {
          setSelectedLead(null);
          refreshAll();
        }}
        onSendMessage={(lead) => {
          setDrawerEmailLead(lead);
        }}
        onAddToCampaign={(lead) => {
          setDrawerAddCampLead(lead);
        }}
        onStartCampaignForLead={(lead) => {
          setSelectedLead(null);
          setCampaignPrefillLeads([lead.id]);
          setSection("campaigns");
        }}
      />

      <DirectEmailModal
        opened={!!drawerEmailLead}
        lead={drawerEmailLead}
        projects={projects}
        senderAccounts={senderAccounts}
        settings={settings}
        onClose={() => setDrawerEmailLead(null)}
        onSent={refreshAll}
      />

      <AddToCampaignModal
        opened={!!drawerAddCampLead}
        leadIds={drawerAddCampLead ? [drawerAddCampLead.id] : []}
        leadSummaryLabel={drawerAddCampLead?.companyName}
        campaigns={campaigns}
        onClose={() => setDrawerAddCampLead(null)}
        onAdded={refreshAll}
        onCreateNewCampaign={(ids) => {
          setSelectedLead(null);
          setCampaignPrefillLeads(ids);
          setSection("campaigns");
        }}
      />

      <AssistantDrawer
        opened={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        activeSearchId={activeSearchId}
        settings={settings}
        onAfterAction={async ({ navigateTo, openSearchId, dataChanged }) => {
          if (dataChanged) {
            await refreshAll();
          }
          if (openSearchId) {
            setActiveSearchId(openSearchId);
            setSection("searches");
          } else if (navigateTo) {
            setSection(navigateTo);
          }
        }}
      />
    </>
  );
}
