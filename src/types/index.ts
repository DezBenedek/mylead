export interface Offer {
  id: string;
  projectId: string;
  title: string;
  offerType: "discount" | "free_trial" | "audit" | "bundle" | "custom" | string;
  discountValue: string;
  description: string;
  ctaText: string;
  conditions: string;
  active: boolean;
  createdAt: string;
}

export interface OfferInput {
  id?: string | null;
  projectId: string;
  title: string;
  offerType: string;
  discountValue: string;
  description: string;
  ctaText: string;
  conditions: string;
  active: boolean;
}

export interface Project {
  id: string;
  name: string;
  websiteUrl: string;
  industry: string;
  language: string;
  description: string;
  bookingUrl: string;
  landingUrl: string;
  emailSignature: string;
  valueProposition: string;
  targetAudience: string;
  painPointsSolved: string[];
  pitchAngles: string[];
  objectionHandlers: string[];
  crawledSummary: string;
  crawledPagesCount: number;
  lastCrawledAt: string | null;
  offers: Offer[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  id?: string | null;
  name: string;
  websiteUrl: string;
  industry: string;
  language: string;
  description: string;
  bookingUrl: string;
  landingUrl: string;
  emailSignature?: string | null;
  valueProposition?: string | null;
  targetAudience?: string | null;
  painPointsSolved?: string[] | null;
  pitchAngles?: string[] | null;
  objectionHandlers?: string[] | null;
}

export interface SearchJob {
  id: string;
  projectId: string;
  projectName: string;
  offerId: string | null;
  offerTitle: string | null;
  name: string;
  query: string;
  industry: string;
  location: string;
  companySize: string;
  targetProblem: string;
  source: string;
  maxResults: number;
  autoAudit: boolean;
  autoEnrichThreshold: number;
  status: string;
  leadsFound: number;
  promisingCount: number;
  lastError: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export interface SearchJobInput {
  id?: string | null;
  projectId: string;
  offerId?: string | null;
  name: string;
  query: string;
  industry: string;
  location: string;
  companySize: string;
  targetProblem: string;
  source: string;
  maxResults: number;
  autoAudit: boolean;
  autoEnrichThreshold: number;
}

export interface LeadProvenance {
  searchId: string;
  searchName: string;
  foundAt: string;
}

export interface LeadContact {
  name: string;
  role: string;
  email: string;
  phone: string;
  source: string;
}

export interface WebsiteAudit {
  reachable: boolean;
  statusCode: number | null;
  hasHttps: boolean;
  loadTimeMs: number;
  hasMobileViewport: boolean;
  title: string;
  metaDescription: string;
  hasAnalytics: boolean;
  hasChatWidget: boolean;
  hasBookingSystem: boolean;
  hasContactForm: boolean;
  techStack: string[];
  detectedIssues: string[];
  extractedEmails: string[];
  extractedPhones: string[];
  socialLinks: string[];
  pagesCrawled: number;
  auditedAt: string;
  overallScore?: number;
  scoreSeo?: number;
  scoreUxMobile?: number;
  scoreConversion?: number;
  scoreTrust?: number;
  htmlSizeKb?: number;
  h1Count?: number;
  h1Text?: string;
  imageCount?: number;
  imagesMissingAlt?: number;
  hasOgTags?: boolean;
  hasCanonical?: boolean;
  hasStructuredData?: boolean;
  hasPricingSignals?: boolean;
  hasTestimonials?: boolean;
  hasGdprPrivacy?: boolean;
  hasMultilingual?: boolean;
  hasCtaSignals?: boolean;
  copyrightYear?: number | null;
  strengths?: string[];
}

export interface Lead {
  id: string;
  companyName: string;
  domain: string;
  websiteUrl: string;
  industry: string;
  location: string;
  address: string;
  phone: string;
  primaryEmail: string;
  employeeEstimate: string;
  googleRating: number | null;
  googleReviews: number | null;
  source: string;
  status: string;
  fitScore: number;
  enriched: boolean;
  companySummary: string;
  painPoints: string[];
  howWeCanHelp: string;
  recommendedPitch: string;
  techStack: string[];
  contacts: LeadContact[];
  audit: WebsiteAudit | null;
  tags: string[];
  notes: string;
  searches: LeadProvenance[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadUpdateInput {
  id: string;
  companyName?: string | null;
  websiteUrl?: string | null;
  location?: string | null;
  phone?: string | null;
  status?: string | null;
  primaryEmail?: string | null;
  employeeEstimate?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

export interface SenderAccount {
  id: string;
  name: string;
  provider: "smtp" | "ses" | string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  smtpSecurity: string;
  sesRegion: string;
  sesAccessKey: string;
  sesSecretKey: string;
  dailyLimit: number;
  sentToday: number;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPassword: string;
  imapEnabled: boolean;
  isDefault: boolean;
  createdAt: string;
}

export interface SenderAccountInput {
  id?: string | null;
  name: string;
  provider: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  smtpSecurity: string;
  sesRegion: string;
  sesAccessKey: string;
  sesSecretKey: string;
  dailyLimit: number;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPassword: string;
  imapEnabled: boolean;
  isDefault: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  offerId: string | null;
  offerTitle: string | null;
  searchId: string | null;
  searchName: string | null;
  senderAccountId: string | null;
  senderName: string | null;
  status: string;
  tone: string;
  language: string;
  autoReplyMode: string;
  dailyLimit: number;
  minDelaySec: number;
  followUpDays: number;
  includeBookingLink: boolean;
  customInstructions: string;
  offerSummary: string;
  offerTiming: "first_email" | "on_interest" | "on_objection" | "custom" | string;
  offerDelivery: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  replyCount: number;
  positiveCount: number;
  bookedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignInput {
  id?: string | null;
  name: string;
  projectId: string;
  offerId?: string | null;
  searchId?: string | null;
  senderAccountId?: string | null;
  tone: string;
  language: string;
  autoReplyMode: string;
  dailyLimit: number;
  minDelaySec: number;
  followUpDays: number;
  includeBookingLink: boolean;
  customInstructions: string;
  offerSummary: string;
  offerTiming: string;
  offerDelivery: string;
  leadIds: string[];
}

export interface EmailMessage {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  leadId: string;
  leadCompany: string;
  leadEmail: string;
  direction: "outbound" | "inbound" | string;
  status: string;
  stepNumber: number;
  subject: string;
  body: string;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  aiIntent: string | null;
  aiSuggestedReply: string | null;
  bookingLinkSent: boolean;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  scheduledSendAt?: string | null;
  autoSendStatus?: "scheduled" | "paused" | "cancelled" | "sent" | "failed" | string | null;
  aiSummary?: string | null;
  aiRewriteNote?: string | null;
  aiPriorityScore?: number;
  aiTags?: string[];
}

export interface InboxThread {
  leadId: string;
  leadCompany: string;
  leadEmail: string;
  leadStatus: string;
  fitScore: number;
  campaignId: string | null;
  campaignName: string | null;
  offerTitle?: string | null;
  lastMessageAt: string;
  lastDirection: string;
  latestIntent: string | null;
  priorityScore?: number;
  aiTags?: string[];
  decisionSummary?: string | null;
  hasPendingDraft: boolean;
  pendingReplyId?: string | null;
  scheduledSendAt?: string | null;
  autoSendStatus?: "scheduled" | "paused" | "cancelled" | "sent" | "failed" | string | null;
  bookingLinkSent: boolean;
  messageCount: number;
  messages: EmailMessage[];
}

export interface GeneratedEmail {
  subject: string;
  body: string;
}

export interface DirectEmailInput {
  leadId: string;
  senderAccountId?: string | null;
  offerId?: string | null;
  subject: string;
  body: string;
  dryRun: boolean;
  scheduleMode: "now" | "auto_random" | "custom";
  scheduledSendAt?: string | null;
}

export interface CreateLeadInput {
  companyName: string;
  websiteUrl: string;
  industry: string;
  location: string;
  phone: string;
  primaryEmail: string;
  notes: string;
  runAudit: boolean;
}

export interface CampaignUpdateInput {
  id: string;
  name?: string | null;
  projectId?: string | null;
  offerId?: string | null;
  senderAccountId?: string | null;
  status?: string | null;
  tone?: string | null;
  autoReplyMode?: string | null;
  dailyLimit?: number | null;
  includeBookingLink?: boolean | null;
  customInstructions?: string | null;
  offerSummary?: string | null;
  offerTiming?: string | null;
  offerDelivery?: string | null;
}

export interface AppSettings {
  aiProvider: string;
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  aiCliPath: string;
  googlePlacesApiKey: string;
  serperApiKey: string;
  searxngUrl: string;
  gmapsScraperPath: string;
  cliSearchEngine: string;
  defaultLanguage: string;
  companySignature: string;
  signatureFinePrint?: string;
  imapPollMinutes: number;
  autoReplyEnabled: boolean;
  autoReplyWorkdays: number[];
  autoReplyStartHour: number;
  autoReplyEndHour: number;
  autoReplyMinDelayMin: number;
  autoReplyMaxDelayMin: number;
  autoReplyDefaultDryRun: boolean;
  aiAnalysisFocus: string;
  aiReplyInstructions: string;
  defaultTone: string;
  defaultDailyLimit: number;
  decisionModelProvider?: string;
  decisionModelApi?: string; // "decisions" (Decisions API) | "chat" (legacy Structured Outputs)
  decisionModelApiKey?: string;
  decisionModelId?: string;
  decisionAutoSortInbox?: boolean;
}

export interface DiscoveryToolStatus {
  id: string;
  name: string;
  available: boolean;
  detail: string;
  installable: boolean;
}

export interface LocalCliStatus {
  id: string;
  name: string;
  binary: string;
  installed: boolean;
  path: string;
  version: string;
}

export interface AiModelOption {
  id: string;
  label: string;
}

export interface SuppressionEntry {
  email: string;
  reason: string;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  kind: string;
  title: string;
  detail: string;
  leadId: string | null;
  createdAt: string;
}

export interface FunnelStep {
  label: string;
  count: number;
  rate: number;
}

export interface DailyMetric {
  date: string;
  sent: number;
  replies: number;
  positive: number;
  booked: number;
}

export interface SearchStat {
  searchId: string;
  searchName: string;
  leadsCount: number;
  avgFitScore: number;
  enrichedCount: number;
  repliedCount: number;
  bookedCount: number;
}

export interface AnalyticsOverview {
  totalProjects: number;
  totalSearches: number;
  totalLeads: number;
  promisingLeads: number;
  enrichedLeads: number;
  leadsWithEmail: number;
  avgFitScore: number;
  totalSent: number;
  totalFailed: number;
  totalReplies: number;
  positiveReplies: number;
  bookingLinksSent: number;
  bookedLeads: number;
  unsubscribedCount: number;
  deliveryRate: number;
  replyRate: number;
  positiveRate: number;
  bookingRate: number;
  funnel: FunnelStep[];
  dailyMetrics: DailyMetric[];
  searchStats: SearchStat[];
  recentActivity: ActivityItem[];
}

export interface JobProgressEvent {
  jobType: string;
  jobId: string;
  current: number;
  total: number;
  message: string;
}

export interface SearchLiveEvent {
  searchId: string;
  phase:
    | "starting"
    | "discovering"
    | "merging"
    | "batch_start"
    | "auditing"
    | "deep_enriching"
    | "lead_done"
    | "stopped"
    | "completed"
    | "failed"
    | string;
  leadId: string | null;
  companyName: string | null;
  domain: string | null;
  fitScore: number | null;
  status: string | null;
  message: string;
  current: number;
  total: number;
  round: number;
  batch: number;
  continuous: boolean;
  currentUrl?: string | null;
  pagesCrawled?: number | null;
  pagesTotal?: number | null;
  timestamp: string;
}

export interface CsvImportResult {
  searchId: string;
  searchName: string;
  importedCount: number;
  skippedCount: number;
}

export interface AssistantStatusEvent {
  stage: string;
  message: string;
}

export interface SearchOptimizationResult {
  name: string;
  query: string;
  industry: string;
  location: string;
  companySize: string;
  targetProblem: string;
  source: string;
  maxResults: number;
  autoEnrichThreshold: number;
  offerId: string | null;
  reasoning: string;
  aiError?: string | null;
}

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantActionLog {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface AssistantResponse {
  reply: string;
  actions: AssistantActionLog[];
  navigateTo: string | null;
  openSearchId: string | null;
  dataChanged: boolean;
  aiError?: string | null;
}

export type NavSection =
  | "dashboard"
  | "projects"
  | "searches"
  | "leads"
  | "campaigns"
  | "inbox"
  | "analytics"
  | "settings";
