import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconExternalLink,
  IconMail,
  IconMapPin,
  IconPhone,
  IconRefresh,
  IconSend,
  IconTrash,
  IconUsers,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { api, formatShortDate, LEAD_STATUS_META } from "../lib/api";
import type { Lead, Project, SearchLiveEvent } from "../types";

interface Props {
  lead: Lead | null;
  projects: Project[];
  liveWorker?: SearchLiveEvent | null;
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
  onDeleted?: (leadId: string) => void;
  onSendMessage?: (lead: Lead) => void;
  onAddToCampaign?: (lead: Lead) => void;
  onStartCampaignForLead: (lead: Lead) => void;
}

export function LeadDrawer({
  lead,
  projects,
  liveWorker,
  onClose,
  onUpdated,
  onDeleted,
  onSendMessage,
  onAddToCampaign,
  onStartCampaignForLead,
}: Props) {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [employeeEst, setEmployeeEst] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    if (lead) {
      setCompanyName(lead.companyName);
      setWebsiteUrl(lead.websiteUrl);
      setLocation(lead.location);
      setPhone(lead.phone);
      setStatus(lead.status);
      setEmail(lead.primaryEmail);
      setEmployeeEst(lead.employeeEstimate);
      setNotes(lead.notes);
    }
  }, [lead]);

  if (!lead) return null;

  const isNewUnaudited = !lead.audit && lead.fitScore === 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateLead({
        id: lead.id,
        companyName: companyName.trim() || lead.companyName,
        websiteUrl: websiteUrl.trim(),
        location: location.trim(),
        phone: phone.trim(),
        status,
        primaryEmail: email.trim(),
        employeeEstimate: employeeEst.trim(),
        notes,
      });
      onUpdated(updated);
      notifications.show({ title: "Lead mentve", message: updated.companyName, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Mentési hiba", message: String(e), color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeepEnrich = async () => {
    setEnriching(true);
    try {
      const [updated] = await api.enrichLeads([lead.id], projects[0]?.id || null);
      if (updated) {
        onUpdated(updated);
        notifications.show({
          title: "Mély adatlap frissítve",
          message: `${updated.companyName} — Fit Score: ${updated.fitScore}/100`,
          color: "forest",
        });
      }
    } catch (e) {
      notifications.show({ title: "Gazdagítási hiba", message: String(e), color: "red" });
    } finally {
      setEnriching(false);
    }
  };

  const scoreClass =
    lead.fitScore >= 75 ? "ml-score-high" : lead.fitScore >= 55 ? "ml-score-mid" : "ml-score-low";

  return (
    <Drawer
      opened={!!lead}
      onClose={onClose}
      position="right"
      size="lg"
      padding="lg"
      title={
        <Group gap={10}>
          <Text fw={700} size="md">
            {lead.companyName}
          </Text>
          {isNewUnaudited ? (
            <Badge size="xs" color="gray" variant="outline">
              Új — auditra vár
            </Badge>
          ) : (
            <span className={`ml-score-pill ${scoreClass}`}>{lead.fitScore} / 100</span>
          )}
          {lead.enriched && (
            <Badge size="xs" color="forest" variant="outline">
              Mély adatlap
            </Badge>
          )}
        </Group>
      }
    >
      <Stack gap="md">
        {/* Live Deep Research Banner if this lead is actively being crawled right now */}
        {liveWorker && (
          <Paper p="sm" style={{ borderColor: "#166534", backgroundColor: "var(--ml-canvas)" }}>
            <Group justify="space-between" mb={4}>
              <Group gap={6}>
                <Loader size={13} color="forest" />
                <Text size="xs" fw={700}>
                  {liveWorker.phase === "deep_enriching"
                    ? "Mély weboldal-kutatás folyamatban"
                    : "Weboldal-audit folyamatban"}
                </Text>
              </Group>
              <Badge size="xs" color="forest" className="ml-tabular">
                {liveWorker.pagesCrawled ?? 1} / {liveWorker.pagesTotal ?? 6} oldal
              </Badge>
            </Group>
            <Progress
              value={Math.min(
                100,
                Math.round(
                  ((liveWorker.pagesCrawled ?? 1) / Math.max(liveWorker.pagesTotal ?? 6, 1)) * 100
                )
              )}
              size={4}
              color="forest"
              mb={4}
            />
            <Text size="11px" c="dimmed" className="ml-mono" truncate>
              {liveWorker.currentUrl || liveWorker.message}
            </Text>
          </Paper>
        )}

        {/* Helpful onboarding callout for brand-new unaudited leads */}
        {isNewUnaudited && !liveWorker && (
          <Paper p="sm" style={{ backgroundColor: "var(--ml-canvas)" }}>
            <Text size="xs" fw={600}>
              Új, még nem auditált cég
            </Text>
            <Text size="xs" c="dimmed" mt={2}>
              Kattints az alábbi „Audit & Mély kutatás” gombra, hogy a rendszer bejárja a weboldalt,
              kinyerje az e-mail címeket és megmondja, jó fit-e a projektedhez. (Ha hiányzik a
              weboldal URL, a „Szerkesztés” fülön megadhatod.)
            </Text>
          </Paper>
        )}
        {/* Quick Metadata Bar */}
        <Group gap="xs" wrap="wrap">
          {lead.websiteUrl && (
            <Badge
              variant="default"
              leftSection={<IconWorld size={12} />}
              rightSection={
                <ActionIcon
                  component="a"
                  href={lead.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  size="xs"
                  variant="transparent"
                >
                  <IconExternalLink size={11} />
                </ActionIcon>
              }
            >
              {lead.domain || lead.websiteUrl}
            </Badge>
          )}
          {lead.location && (
            <Badge variant="default" leftSection={<IconMapPin size={12} />}>
              {lead.location}
            </Badge>
          )}
          {lead.employeeEstimate && (
            <Badge variant="default" leftSection={<IconUsers size={12} />}>
              {lead.employeeEstimate}
            </Badge>
          )}
          {lead.googleRating && (
            <Badge variant="default" className="ml-tabular">
              Google: {lead.googleRating.toFixed(1)} ({lead.googleReviews ?? 0} ért.)
            </Badge>
          )}
        </Group>

        {/* Provenance Searches */}
        {lead.searches.length > 0 && (
          <Box>
            <Text className="ml-section-label" mb={4}>
              Keresési források (Honnan került az adatbázisba)
            </Text>
            <Group gap={6}>
              {lead.searches.map((s) => (
                <Badge key={s.searchId} color="gray" variant="light">
                  {s.searchName}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        {/* Primary Action Strip */}
        <Group gap="xs" wrap="wrap">
          <Button
            size="xs"
            variant="filled"
            leftSection={<IconRefresh size={14} />}
            loading={enriching}
            onClick={handleDeepEnrich}
          >
            Mély adatlap gazdagítása
          </Button>
          {onSendMessage && (
            <Button
              size="xs"
              variant="light"
              color="forest"
              leftSection={<IconMail size={14} />}
              disabled={!lead.primaryEmail}
              onClick={() => onSendMessage(lead)}
            >
              Üzenet küldése
            </Button>
          )}
          <Button
            size="xs"
            variant="default"
            leftSection={<IconSend size={14} />}
            disabled={!lead.primaryEmail}
            onClick={() => (onAddToCampaign ? onAddToCampaign(lead) : onStartCampaignForLead(lead))}
          >
            Kampányba vétel
          </Button>
          {onDeleted && (
            <ActionIcon
              size="md"
              variant="subtle"
              color="red"
              title="Lead törlése"
              onClick={async () => {
                try {
                  await api.deleteLeads([lead.id]);
                  onDeleted(lead.id);
                  notifications.show({ title: "Lead törölve", message: lead.companyName, color: "gray" });
                } catch (e) {
                  notifications.show({ title: "Törlési hiba", message: String(e), color: "red" });
                }
              }}
            >
              <IconTrash size={15} />
            </ActionIcon>
          )}
        </Group>

        <Tabs defaultValue="intel">
          <Tabs.List>
            <Tabs.Tab value="intel">Áttekintés & Okosűrlap</Tabs.Tab>
            <Tabs.Tab value="audit">Weboldal-audit</Tabs.Tab>
            <Tabs.Tab value="contacts">Kapcsolatok ({lead.contacts.length})</Tabs.Tab>
            <Tabs.Tab value="edit">Szerkesztés & Jegyzet</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="intel" pt="md">
            <Stack gap="sm">
              <Paper p="sm">
                <Text className="ml-section-label" mb={4}>
                  Rövid cégáttekintés
                </Text>
                <Text size="sm">{lead.companySummary || "Még nincs feldolgozott összefoglaló."}</Text>
              </Paper>

              <Paper p="sm" style={{ borderColor: "#166534" }}>
                <Text className="ml-section-label" mb={6} c="forest.9">
                  Nagyságrendi áttekintés — Mit tehet az okosűrlap / megoldásunk ezért a cégért
                </Text>
                <Text size="sm" style={{ whiteSpace: "pre-line", lineHeight: 1.55 }}>
                  {lead.howWeCanHelp || "Futtass mély gazdagítást az okosűrlap-értékeléshez."}
                </Text>
              </Paper>

              <Paper p="sm">
                <Text className="ml-section-label" mb={6}>
                  Feltárt problémák / Hiányosságok
                </Text>
                {lead.painPoints.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Futtass weboldal-auditot vagy mély gazdagítást a problémák feltárásához.
                  </Text>
                ) : (
                  <Stack gap={6}>
                    {lead.painPoints.map((p, idx) => (
                      <Group key={idx} gap={8} align="flex-start" wrap="nowrap">
                        <Text size="sm" c="red.7" fw={700}>
                          •
                        </Text>
                        <Text size="sm">{p}</Text>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Paper>

              {lead.techStack.length > 0 && (
                <Paper p="sm">
                  <Text className="ml-section-label" mb={6}>
                    Felismert technológiák
                  </Text>
                  <Group gap={6}>
                    {lead.techStack.map((t) => (
                      <Badge key={t} variant="default">
                        {t}
                      </Badge>
                    ))}
                  </Group>
                </Paper>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="audit" pt="md">
            {!lead.audit ? (
              <Paper p="md">
                <Text size="sm" c="dimmed">
                  Ehhez a céghez még nem készült technikai weboldal-audit. Kattints a „Mély adatlap
                  gazdagítása” gombra!
                </Text>
              </Paper>
            ) : (
              <Stack gap="sm">
                {/* Category Scorecard (SEO / UX / Conversion / Trust) */}
                <Paper p="sm">
                  <Group justify="space-between" mb="xs">
                    <Box>
                      <Text className="ml-section-label">Weboldal Minőségi Pontszám (CRO & SEO)</Text>
                      <Text size="xs" c="dimmed">
                        Alacsonyabb pontszám = nagyobb fejlesztési potenciál az ajánlatodhoz
                      </Text>
                    </Box>
                    <Badge
                      size="lg"
                      color={
                        (lead.audit.overallScore ?? 0) >= 75
                          ? "green"
                          : (lead.audit.overallScore ?? 0) >= 50
                          ? "yellow"
                          : "red"
                      }
                      className="ml-tabular"
                    >
                      {lead.audit.overallScore ?? "—"} / 100
                    </Badge>
                  </Group>

                  <SimpleGrid cols={2} spacing="xs">
                    {[
                      { label: "SEO & Kereshetőség", val: lead.audit.scoreSeo ?? 0 },
                      { label: "UX & Mobil sebesség", val: lead.audit.scoreUxMobile ?? 0 },
                      { label: "Konverzió & Foglalás", val: lead.audit.scoreConversion ?? 0 },
                      { label: "Bizalom & GDPR", val: lead.audit.scoreTrust ?? 0 },
                    ].map((cat) => (
                      <Box key={cat.label}>
                        <Group justify="space-between" mb={3}>
                          <Text size="xs" fw={500}>
                            {cat.label}
                          </Text>
                          <Text size="xs" fw={600} className="ml-tabular">
                            {cat.val}/100
                          </Text>
                        </Group>
                        <Progress
                          value={cat.val}
                          size={5}
                          color={cat.val >= 75 ? "green" : cat.val >= 50 ? "yellow" : "red"}
                        />
                      </Box>
                    ))}
                  </SimpleGrid>
                </Paper>

                {/* Detailed Signal Checklist */}
                <SimpleGrid cols={2} spacing="xs">
                  {[
                    { label: "Weboldal elérhető", ok: lead.audit.reachable },
                    { label: "HTTPS / SSL aktív", ok: lead.audit.hasHttps },
                    { label: "Mobilbarát viewport", ok: lead.audit.hasMobileViewport },
                    { label: "Online időpontfoglaló", ok: lead.audit.hasBookingSystem },
                    { label: "Analitika (GA4 / Pixel)", ok: lead.audit.hasAnalytics },
                    { label: "Élő chat widget", ok: lead.audit.hasChatWidget },
                    { label: "Kapcsolati / ajánlat űrlap", ok: lead.audit.hasContactForm },
                    { label: "GDPR / Impresszum", ok: !!lead.audit.hasGdprPrivacy },
                    { label: "Ügyfélvélemények / Ref.", ok: !!lead.audit.hasTestimonials },
                    { label: "Árak / Csomagok kommunikálva", ok: !!lead.audit.hasPricingSignals },
                    { label: "Schema.org (JSON-LD)", ok: !!lead.audit.hasStructuredData },
                    { label: "OpenGraph (Social meta)", ok: !!lead.audit.hasOgTags },
                    { label: "Egyértelmű CTA", ok: !!lead.audit.hasCtaSignals },
                    { label: "Többnyelvűség (EN/DE)", ok: !!lead.audit.hasMultilingual },
                  ].map((item) => (
                    <Paper key={item.label} p="xs">
                      <Group justify="space-between">
                        <Text size="xs" fw={500}>
                          {item.label}
                        </Text>
                        {item.ok ? (
                          <Badge size="xs" color="green" leftSection={<IconCheck size={10} />}>
                            Van
                          </Badge>
                        ) : (
                          <Badge size="xs" color="red" leftSection={<IconX size={10} />}>
                            Hiányzik
                          </Badge>
                        )}
                      </Group>
                    </Paper>
                  ))}
                </SimpleGrid>

                {/* Technical Diagnostics */}
                <SimpleGrid cols={3} spacing="xs">
                  <Paper p="xs">
                    <Text className="ml-section-label">Válaszidő</Text>
                    <Text size="sm" fw={700} className="ml-tabular">
                      {lead.audit.loadTimeMs} ms
                    </Text>
                  </Paper>
                  <Paper p="xs">
                    <Text className="ml-section-label">HTML méret / H1</Text>
                    <Text size="sm" fw={700} className="ml-tabular">
                      {lead.audit.htmlSizeKb ?? 0} KB • {lead.audit.h1Count ?? 0} H1
                    </Text>
                  </Paper>
                  <Paper p="xs">
                    <Text className="ml-section-label">Copyright év</Text>
                    <Text
                      size="sm"
                      fw={700}
                      className="ml-tabular"
                      c={
                        lead.audit.copyrightYear && lead.audit.copyrightYear <= 2023
                          ? "red"
                          : undefined
                      }
                    >
                      {lead.audit.copyrightYear ?? "Nincs"}
                    </Text>
                  </Paper>
                </SimpleGrid>

                {/* Issues & Strengths */}
                {lead.audit.detectedIssues.length > 0 && (
                  <Paper p="sm">
                    <Text className="ml-section-label" mb={6}>
                      Feltárt technikai & konverziós hibák ({lead.audit.detectedIssues.length})
                    </Text>
                    <Stack gap={4}>
                      {lead.audit.detectedIssues.map((iss, idx) => (
                        <Text key={idx} size="xs" c="red.8">
                          • {iss}
                        </Text>
                      ))}
                    </Stack>
                  </Paper>
                )}

                {lead.audit.strengths && lead.audit.strengths.length > 0 && (
                  <Paper p="sm">
                    <Text className="ml-section-label" mb={6}>
                      Erősségek
                    </Text>
                    <Group gap={6}>
                      {lead.audit.strengths.map((s, idx) => (
                        <Badge key={idx} size="xs" color="green" variant="light">
                          {s}
                        </Badge>
                      ))}
                    </Group>
                  </Paper>
                )}

                <Paper p="sm">
                  <Text className="ml-section-label" mb={4}>
                    Meta & Bejárási adatok
                  </Text>
                  <Text size="xs" c="dimmed">
                    Bejárt aloldalak: {lead.audit.pagesCrawled} • Képek alt nélkül:{" "}
                    {lead.audit.imagesMissingAlt ?? 0}/{lead.audit.imageCount ?? 0} • Auditálva:{" "}
                    {formatShortDate(lead.audit.auditedAt)}
                  </Text>
                  {lead.audit.title && (
                    <Text size="xs" mt={6}>
                      <strong>Title:</strong> {lead.audit.title}
                    </Text>
                  )}
                  {lead.audit.h1Text && (
                    <Text size="xs" mt={3}>
                      <strong>H1:</strong> {lead.audit.h1Text}
                    </Text>
                  )}
                  {lead.audit.metaDescription && (
                    <Text size="xs" mt={3}>
                      <strong>Meta:</strong> {lead.audit.metaDescription}
                    </Text>
                  )}
                </Paper>
              </Stack>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="contacts" pt="md">
            <Stack gap="xs">
              <Paper p="sm">
                <Text className="ml-section-label" mb={6}>
                  Elsődleges elérhetőségek
                </Text>
                <Stack gap={4}>
                  <Group gap={8}>
                    <IconMail size={14} />
                    <Text size="sm" className="ml-mono">
                      {lead.primaryEmail || "Nincs e-mail cím"}
                    </Text>
                  </Group>
                  <Group gap={8}>
                    <IconPhone size={14} />
                    <Text size="sm" className="ml-mono">
                      {lead.phone || "Nincs telefonszám"}
                    </Text>
                  </Group>
                  <Group gap={8}>
                    <IconMapPin size={14} />
                    <Text size="sm">{lead.address || lead.location || "Nincs cím"}</Text>
                  </Group>
                </Stack>
              </Paper>

              {lead.contacts.map((c, i) => (
                <Paper key={i} p="sm">
                  <Group justify="space-between">
                    <Box>
                      <Text size="sm" fw={600}>
                        {c.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {c.role} • Forrás: {c.source}
                      </Text>
                    </Box>
                    <Text size="xs" className="ml-mono">
                      {c.email}
                    </Text>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="edit" pt="md">
            <Stack gap="sm">
              <SimpleGrid cols={2}>
                <TextInput
                  label="Cégnév"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.currentTarget.value)}
                />
                <TextInput
                  label="Weboldal URL"
                  placeholder="https://ceg.hu"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.currentTarget.value)}
                />
              </SimpleGrid>
              <SimpleGrid cols={2}>
                <TextInput
                  label="Lokáció / Város"
                  placeholder="Budapest"
                  value={location}
                  onChange={(e) => setLocation(e.currentTarget.value)}
                />
                <TextInput
                  label="Telefonszám"
                  placeholder="+36 ..."
                  value={phone}
                  onChange={(e) => setPhone(e.currentTarget.value)}
                />
              </SimpleGrid>
              <Select
                label="Lead státusz"
                value={status}
                onChange={(v) => setStatus(v || "new")}
                data={Object.entries(LEAD_STATUS_META).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                }))}
              />
              <TextInput
                label="Elsődleges e-mail cím"
                placeholder="info@ceg.hu"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <TextInput
                label="Becsült alkalmazotti létszám"
                placeholder="pl. 10-25 fő"
                value={employeeEst}
                onChange={(e) => setEmployeeEst(e.currentTarget.value)}
              />
              <Textarea
                label="Belső jegyzetek"
                minRows={4}
                placeholder="Megjegyzések, döntéshozó neve, hívás összefoglaló..."
                value={notes}
                onChange={(e) => setNotes(e.currentTarget.value)}
              />
              <Divider />
              <Group justify="flex-end">
                <Button onClick={handleSave} loading={saving}>
                  Változások mentése
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Drawer>
  );
}
