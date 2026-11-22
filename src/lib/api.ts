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
  CampaignUpdateInput,
  CreateLeadInput,
  CsvImportResult,
  DirectEmailInput,
  DiscoveryToolStatus,
  EmailMessage,
  GeneratedEmail,
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
  bulkUpdateLeadStatus: (ids: string[], status: string) =>
    invoke<number>("bulk_update_lead_status", { ids, status }),
  createManualLead: (input: CreateLeadInput) => invoke<Lead>("create_manual_lead", { input }),
  enrichLeads: (leadIds: string[], projectId?: string | null) =>
    invoke<Lead[]>("enrich_leads", { leadIds, projectId: projectId || null }),

  // Campaigns
  listCampaigns: () => invoke<Campaign[]>("list_campaigns"),
  listCampaignMessages: (campaignId: string) =>
    invoke<EmailMessage[]>("list_campaign_messages", { campaignId }),
  createCampaignWithDrafts: (input: CampaignInput) =>
    invoke<Campaign>("create_campaign_with_drafts", { input }),
  updateCampaign: (input: CampaignUpdateInput) => invoke<Campaign>("update_campaign", { input }),
  addLeadsToCampaign: (campaignId: string, leadIds: string[], generateDrafts: boolean) =>
    invoke<Campaign>("add_leads_to_campaign", { campaignId, leadIds, generateDrafts }),
  regenerateCampaignDrafts: (
    campaignId: string,
    instruction?: string | null,
    saveToCampaign?: boolean
  ) =>
    invoke<Campaign>("regenerate_campaign_drafts", {
      campaignId,
      instruction: instruction || null,
      saveToCampaign: saveToCampaign ?? true,
    }),
  updateEmailDraft: (messageId: string, subject: string, body: string) =>
    invoke<void>("update_email_draft", { messageId, subject, body }),
  regenerateEmailDraft: (messageId: string, instruction?: string | null) =>
    invoke<EmailMessage>("regenerate_email_draft", {
      messageId,
      instruction: instruction || null,
    }),
  deleteCampaign: (id: string) => invoke<void>("delete_campaign", { id }),
  sendCampaignDrafts: (campaignId: string, dryRun: boolean) =>
    invoke<Campaign>("send_campaign_drafts", { campaignId, dryRun }),

  // Direct Email to Lead
  generateDirectEmailDraft: (
    leadId: string,
    offerId: string | null,
    tone: string,
    instruction: string
  ) =>
    invoke<GeneratedEmail>("generate_direct_email_draft", {
      leadId,
      offerId: offerId || null,
      tone,
      instruction,
    }),
  sendDirectEmail: (input: DirectEmailInput) => invoke<InboxThread>("send_direct_email", { input }),

  // Inbox & AI Auto-Reply
  listInboxThreads: () => invoke<InboxThread[]>("list_inbox_threads"),
  syncImapInbox: (senderAccountId?: string | null) =>
    invoke<number>("sync_imap_inbox", { senderAccountId: senderAccountId || null }),
  reclassifyInboxThreads: () => invoke<number>("reclassify_inbox_threads"),
  simulateInboundReply: (leadId: string, campaignId: string | null, body: string) =>
    invoke<InboxThread>("simulate_inbound_reply", { leadId, campaignId, body }),
  sendInboxReply: (
    leadId: string,
    campaignId: string | null,
    subject: string,
    body: string,
    dryRun: boolean,
    pendingMessageId?: string | null
  ) =>
    invoke<InboxThread>("send_inbox_reply", {
      leadId,
      campaignId,
      subject,
      body,
      dryRun,
      pendingMessageId: pendingMessageId || null,
    }),
  saveInboxReplyDraft: (
    messageId: string | null,
    leadId: string,
    campaignId: string | null,
    subject: string,
    body: string,
    keepScheduled: boolean
  ) =>
    invoke<InboxThread>("save_inbox_reply_draft", {
      messageId: messageId || null,
      leadId,
      campaignId,
      subject,
      body,
      keepScheduled,
    }),
  controlScheduledReply: (
    messageId: string,
    action: "pause" | "cancel" | "resume" | "reschedule_random" | "reschedule_custom" | "send_now",
    customSendAt?: string | null,
    dryRun?: boolean
  ) =>
    invoke<InboxThread>("control_scheduled_reply", {
      messageId,
      action,
      customSendAt: customSendAt || null,
      dryRun: dryRun ?? null,
    }),
  rewriteInboxReplyWithAi: (
    leadId: string,
    messageId: string | null,
    currentSubject: string,
    currentBody: string,
    instruction: string
  ) =>
    invoke<GeneratedEmail>("rewrite_inbox_reply_with_ai", {
      leadId,
      messageId: messageId || null,
      currentSubject,
      currentBody,
      instruction,
    }),
  generateInboxReplyWithAi: (leadId: string, campaignId?: string | null) =>
    invoke<InboxThread>("generate_inbox_reply_with_ai", {
      leadId,
      campaignId: campaignId || null,
    }),

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
  fetchDecisionModels: () => invoke<AiModelOption[]>("fetch_decision_models"),
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
  onInboxUpdated: (cb: () => void): Promise<UnlistenFn> =>
    listen("inbox-updated", () => cb()),
  onCampaignUpdated: (cb: (campaignId: string) => void): Promise<UnlistenFn> =>
    listen<string>("campaign-updated", (ev) => cb(ev.payload)),
};

export function formatCountdown(iso: string | null | undefined): string {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  const diffSec = Math.floor((target - Date.now()) / 1000);
  if (diffSec <= 0) return "hamarosan küldi…";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} perc múlva`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return `${hrs} ó ${remMins} p múlva`;
  const days = Math.floor(hrs / 24);
  return `${days} nap ${hrs % 24} ó múlva`;
}

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
