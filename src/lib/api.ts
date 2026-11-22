import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiModelOption,
  AnalyticsOverview,
  AppSettings,
  AssistantChatMessage,
  AssistantResponse,
  AssistantStatusEvent,
  Campaign,
  CampaignInput,
  CsvImportResult,
  DiscoveryToolStatus,
  EmailMessage,
  InboxThread,
  JobProgressEvent,
  Lead,
  LeadUpdateInput,
  LocalCliStatus,
  Offer,
  OfferInput,
  Project,
  ProjectInput,
  SearchJob,
  SearchJobInput,
  SearchLiveEvent,
  SearchOptimizationResult,
  SenderAccount,
  SenderAccountInput,
  SuppressionEntry,
} from "../types";

export const api = {
  // Projects & Offers
  listProjects: () => invoke<Project[]>("list_projects"),
  saveProject: (input: ProjectInput) => invoke<Project>("save_project", { input }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  saveOffer: (input: OfferInput) => invoke<Offer>("save_offer", { input }),
  deleteOffer: (id: string) => invoke<void>("delete_offer", { id }),
  crawlAndAnalyzeProject: (projectId: string) =>
    invoke<Project>("crawl_and_analyze_project", { projectId }),

  // Searches & Discovery
  listSearches: () => invoke<SearchJob[]>("list_searches"),
  saveSearch: (input: SearchJobInput) => invoke<SearchJob>("save_search", { input }),
  deleteSearch: (id: string) => invoke<void>("delete_search", { id }),
  runSearchJob: (searchId: string) => invoke<SearchJob>("run_search_job", { searchId }),
  startSearchJob: (searchId: string, continuous: boolean) =>
    invoke<SearchJob>("start_search_job", { searchId, continuous }),
  stopSearchJob: (searchId: string) => invoke<boolean>("stop_search_job", { searchId }),
  listRunningSearches: () => invoke<string[]>("list_running_searches"),
  optimizeSearchWithAi: (input: SearchJobInput, instruction: string) =>
    invoke<SearchOptimizationResult>("optimize_search_with_ai", { input, instruction }),
  runAssistantCommand: (
    message: string,
    history: AssistantChatMessage[],
    activeSearchId?: string | null
  ) =>
    invoke<AssistantResponse>("run_assistant_command", {
      message,
      history,
      activeSearchId: activeSearchId || null,
    }),
  importCsvAndEvaluate: (
    fileName: string,
    csvContent: string,
    instruction: string,
    projectId?: string | null
  ) =>
    invoke<CsvImportResult>("import_csv_and_evaluate", {
      fileName,
      csvContent,
      instruction,
      projectId: projectId || null,
    }),
  importManualLeads: (searchId: string | null, rawLines: string, runAudit: boolean) =>
    invoke<number>("import_manual_leads", { searchId, rawLines, runAudit }),

  // Central Lead DB
  listLeads: (filters?: {
    searchId?: string | null;
    status?: string | null;
    minScore?: number | null;
    query?: string | null;
  }) =>
    invoke<Lead[]>("list_leads", {
      searchId: filters?.searchId || null,
      status: filters?.status || null,
      minScore: filters?.minScore ?? null,
      query: filters?.query || null,
    }),
  getLead: (id: string) => invoke<Lead>("get_lead", { id }),
  updateLead: (input: LeadUpdateInput) => invoke<Lead>("update_lead", { input }),
  deleteLeads: (ids: string[]) => invoke<void>("delete_leads", { ids }),
  enrichLeads: (leadIds: string[], projectId?: string | null) =>
    invoke<Lead[]>("enrich_leads", { leadIds, projectId: projectId || null }),

  // Campaigns
  listCampaigns: () => invoke<Campaign[]>("list_campaigns"),
  listCampaignMessages: (campaignId: string) =>
    invoke<EmailMessage[]>("list_campaign_messages", { campaignId }),
  createCampaignWithDrafts: (input: CampaignInput) =>
    invoke<Campaign>("create_campaign_with_drafts", { input }),
  updateEmailDraft: (messageId: string, subject: string, body: string) =>
    invoke<void>("update_email_draft", { messageId, subject, body }),
  deleteCampaign: (id: string) => invoke<void>("delete_campaign", { id }),
  sendCampaignDrafts: (campaignId: string, dryRun: boolean) =>
    invoke<Campaign>("send_campaign_drafts", { campaignId, dryRun }),

  // Inbox & AI Auto-Reply
  listInboxThreads: () => invoke<InboxThread[]>("list_inbox_threads"),
  syncImapInbox: (senderAccountId?: string | null) =>
    invoke<number>("sync_imap_inbox", { senderAccountId: senderAccountId || null }),
  simulateInboundReply: (leadId: string, campaignId: string | null, body: string) =>
    invoke<InboxThread>("simulate_inbound_reply", { leadId, campaignId, body }),
  sendInboxReply: (
    leadId: string,
    campaignId: string | null,
    subject: string,
    body: string,
    dryRun: boolean
  ) => invoke<InboxThread>("send_inbox_reply", { leadId, campaignId, subject, body, dryRun }),

  // Sender Accounts & Settings
  listSenderAccounts: () => invoke<SenderAccount[]>("list_sender_accounts"),
  saveSenderAccount: (input: SenderAccountInput) =>
    invoke<SenderAccount>("save_sender_account", { input }),
  deleteSenderAccount: (id: string) => invoke<void>("delete_sender_account", { id }),
  sendTestEmail: (senderAccountId: string, toEmail: string) =>
    invoke<string>("send_test_email", { senderAccountId, toEmail }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
  testAiSettings: (settings: AppSettings) => invoke<string>("test_ai_settings", { settings }),
  detectLocalAiClis: () => invoke<LocalCliStatus[]>("detect_local_ai_clis"),
  fetchAiModels: (settings: AppSettings) =>
    invoke<AiModelOption[]>("fetch_ai_models", { settings }),
  detectDiscoveryTools: () => invoke<DiscoveryToolStatus[]>("detect_discovery_tools"),
  installGmapsScraper: () => invoke<string>("install_gmaps_scraper"),
  listSuppressions: () => invoke<SuppressionEntry[]>("list_suppressions"),
  addSuppression: (email: string, reason: string) =>
    invoke<void>("add_suppression", { email, reason }),
  removeSuppression: (email: string) => invoke<void>("remove_suppression", { email }),

  // Analytics & Demo
  getAnalytics: () => invoke<AnalyticsOverview>("get_analytics"),
  loadDemoData: () => invoke<void>("load_demo_data"),
  clearWorkspaceData: () => invoke<void>("clear_workspace_data"),

  // Live Events
  onJobProgress: (cb: (ev: JobProgressEvent) => void): Promise<UnlistenFn> =>
    listen<JobProgressEvent>("job-progress", (event) => cb(event.payload)),
  onSearchLiveEvent: (cb: (ev: SearchLiveEvent) => void): Promise<UnlistenFn> =>
    listen<SearchLiveEvent>("search-live-event", (event) => cb(event.payload)),
  onAssistantStatus: (cb: (ev: AssistantStatusEvent) => void): Promise<UnlistenFn> =>
    listen<AssistantStatusEvent>("assistant-status", (event) => cb(event.payload)),
};

export const LEAD_STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: "Új", color: "gray" },
  promising: { label: "Ígéretes", color: "teal" },
  enriched: { label: "Gazdagított", color: "forest" },
  in_campaign: { label: "Kampányban", color: "blue" },
  replied: { label: "Válaszolt", color: "orange" },
  booked: { label: "Időpont egyeztetve", color: "green" },
  won: { label: "Ügyfél", color: "forest" },
  disqualified: { label: "Elutasítva", color: "red" },
  unsubscribed: { label: "Leiratkozott", color: "dark" },
};

export const INTENT_META: Record<string, { label: string; color: string }> = {
  booking_request: { label: "Időpontot kér", color: "green" },
  interested: { label: "Érdeklődik", color: "forest" },
  question: { label: "Kérdése van", color: "blue" },
  objection: { label: "Kifogás", color: "yellow" },
  not_interested: { label: "Nem érdekli", color: "red" },
  out_of_office: { label: "Házon kívül", color: "gray" },
  unsubscribe: { label: "Leiratkozás", color: "dark" },
};

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("hu-HU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
