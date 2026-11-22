import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCalendarEvent,
  IconClock,
  IconSend,
  IconSparkles,
  IconTestPipe,
  IconWand,
  IconWorld,
} from "@tabler/icons-react";
import { api } from "../lib/api";
import type { AppSettings, Lead, Project, SenderAccount } from "../types";

interface Props {
  opened: boolean;
  lead: Lead | null;
  leads?: Lead[];
  projects: Project[];
  senderAccounts: SenderAccount[];
  settings: AppSettings;
  onClose: () => void;
  onSent: () => Promise<void>;
}

export function DirectEmailModal({
  opened,
  lead,
  leads = [],
  projects,
  senderAccounts,
  settings,
  onClose,
  onSent,
}: Props) {
  const allOffers = useMemo(
    () =>
      projects.flatMap((p) =>
        p.offers.map((o) => ({
          ...o,
          projectName: p.name,
          bookingUrl: p.bookingUrl,
          landingUrl: p.landingUrl || p.websiteUrl,
        }))
      ),
    [projects]
  );

  const [selectedLeadId, setSelectedLeadId] = useState<string>(lead?.id || "");
  const [offerId, setOfferId] = useState<string>(allOffers[0]?.id || "");
  const [senderAccountId, setSenderAccountId] = useState<string>(
    senderAccounts.find((a) => a.isDefault)?.id || senderAccounts[0]?.id || ""
  );
  const [tone, setTone] = useState<string>(settings.defaultTone || "professional_formal");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"now" | "auto_random" | "custom">("now");
  const [customTime, setCustomTime] = useState("");
  const [generating, setGenerating] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [sending, setSending] = useState(false);

  const activeLead = lead || leads.find((l) => l.id === selectedLeadId) || null;
  const activeOffer = allOffers.find((o) => o.id === offerId) || allOffers[0] || null;

  useEffect(() => {
    if (opened) {
      setSelectedLeadId(lead?.id || leads.find((l) => l.primaryEmail)?.id || "");
      setOfferId(allOffers[0]?.id || "");
      setSenderAccountId(
        senderAccounts.find((a) => a.isDefault)?.id || senderAccounts[0]?.id || ""
      );
      setTone(settings.defaultTone || "professional_formal");
      setSubject(lead ? `${lead.companyName} — rövid megkeresés` : "");
      setBody("");
      setAiNote("");
      setScheduleMode("now");
      const def = new Date(Date.now() + 45 * 60000);
      const localIso = new Date(def.getTime() - def.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setCustomTime(localIso);
    }
  }, [opened, lead?.id]);

  const handleGenerateAi = async () => {
    if (!activeLead) return;
    setGenerating(true);
    try {
      const gen = await api.generateDirectEmailDraft(
        activeLead.id,
        offerId || null,
        tone,
        aiNote.trim()
      );
      setSubject(gen.subject);
      setBody(gen.body);
      notifications.show({
        title: "AI levél elkészült",
        message: "Szabadon átírhatod manuálisan vagy megjegyzéssel.",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "AI generálási hiba", message: String(e), color: "red" });
    } finally {
      setGenerating(false);
    }
  };

  const handleRewriteWithNote = async () => {
    if (!activeLead || !aiNote.trim() || !body.trim()) return;
    setRewriting(true);
    try {
      const gen = await api.rewriteInboxReplyWithAi(
        activeLead.id,
        null,
        subject,
        body,
        aiNote.trim()
      );
      setSubject(gen.subject);
      setBody(gen.body);
      setAiNote("");
      notifications.show({ title: "AI átírta a levelet", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Átírási hiba", message: String(e), color: "red" });
    } finally {
      setRewriting(false);
    }
  };

  const handleSend = async (dryRun: boolean) => {
    if (!activeLead) {
      notifications.show({ title: "Válassz leadet!", message: "", color: "orange" });
      return;
    }
    if (!activeLead.primaryEmail.trim()) {
      notifications.show({
        title: "Hiányzó e-mail cím",
        message: "Ennek a leadnek nincs megadott e-mail címe — előbb add meg az adatlapján!",
        color: "red",
      });
      return;
    }
    if (!subject.trim() || !body.trim()) {
      notifications.show({ title: "Tárgy és szöveg kötelező", message: "", color: "orange" });
      return;
    }
    setSending(true);
    try {
      const scheduledIso =
        scheduleMode === "custom" && customTime ? new Date(customTime).toISOString() : null;
      await api.sendDirectEmail({
        leadId: activeLead.id,
        senderAccountId: senderAccountId || null,
        offerId: offerId || null,
        subject: subject.trim(),
        body: body.trim(),
        dryRun,
        scheduleMode,
        scheduledSendAt: scheduledIso,
      });
      await onSent();
      onClose();
      notifications.show({
        title:
          scheduleMode === "now"
            ? dryRun
              ? "Szimulált üzenet rögzítve"
              : "Üzenet elküldve"
            : "Üzenet időzítve (Beérkezőben követhető)",
        message: `${activeLead.companyName} (${activeLead.primaryEmail})`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Küldési hiba", message: String(e), color: "red" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        activeLead
          ? `Üzenet küldése — ${activeLead.companyName}`
          : "Új közvetlen üzenet küldése leadnek"
      }
      size="lg"
    >
      <Stack gap="sm">
        {!lead && (
          <Select
            label="Címzett cég (Lead)"
            searchable
            required
            placeholder="Keresés cégnév vagy e-mail alapján..."
            value={selectedLeadId}
            onChange={(v) => {
              const id = v || "";
              setSelectedLeadId(id);
              const l = leads.find((x) => x.id === id);
              if (l && !subject) setSubject(`${l.companyName} — rövid megkeresés`);
            }}
            data={leads
              .filter((l) => l.primaryEmail.trim())
              .map((l) => ({
                value: l.id,
                label: `${l.companyName} (${l.primaryEmail}) — Fit ${l.fitScore}`,
              }))}
          />
        )}

        {activeLead && (
          <Paper p="xs" style={{ backgroundColor: "var(--ml-canvas)" }}>
            <Group justify="space-between" wrap="wrap" gap={6}>
              <Text size="xs" className="ml-mono">
                Címzett: <strong>{activeLead.primaryEmail || "Nincs e-mail!"}</strong>
              </Text>
              <Badge size="xs" color={activeLead.fitScore >= 70 ? "forest" : "gray"}>
                Fit: {activeLead.fitScore}
              </Badge>
            </Group>
          </Paper>
        )}

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
          <Select
            label="Ajánlat (AI kontextus)"
            clearable
            value={offerId || null}
            onChange={(v) => setOfferId(v || "")}
            data={allOffers.map((o) => ({
              value: o.id,
              label: `${o.title}${o.discountValue ? ` (${o.discountValue})` : ""}`,
            }))}
          />
          <Select
            label="Hangnem"
            value={tone}
            onChange={(v) => setTone(v || "professional_formal")}
            data={[
              { value: "professional_formal", label: "Szakmai, magázódó" },
              { value: "friendly_direct", label: "Közvetlen, tegeződő" },
              { value: "concise_executive", label: "Tömör, vezetői" },
            ]}
          />
          <Select
            label="Küldő fiók"
            clearable
            value={senderAccountId || null}
            onChange={(v) => setSenderAccountId(v || "")}
            data={senderAccounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${a.provider.toUpperCase()})`,
            }))}
          />
        </SimpleGrid>

        {/* AI Generator & Comment Rewriter */}
        <Paper p="xs" style={{ backgroundColor: "var(--ml-canvas)" }}>
          <Group gap="xs" align="flex-end">
            <TextInput
              size="xs"
              label="Megjegyzés / instrukció az AI-nak (generáláshoz vagy átíráshoz)"
              placeholder="pl. Emeld ki az okosűrlap előszűrését, legyen max 5 mondat..."
              value={aiNote}
              onChange={(e) => setAiNote(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              size="xs"
              variant="filled"
              leftSection={<IconSparkles size={13} />}
              loading={generating}
              disabled={!activeLead}
              onClick={handleGenerateAi}
            >
              AI levél írása
            </Button>
            {body.trim() && (
              <Button
                size="xs"
                variant="default"
                leftSection={<IconWand size={13} />}
                loading={rewriting}
                disabled={!aiNote.trim()}
                onClick={handleRewriteWithNote}
              >
                Átírás
              </Button>
            )}
          </Group>
        </Paper>

        <TextInput
          label="Tárgy"
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
          placeholder="Levél tárgya..."
        />

        <BoxWithQuickLinks
          body={body}
          onChange={setBody}
          landingUrl={activeOffer?.landingUrl || projects[0]?.landingUrl || projects[0]?.websiteUrl || ""}
          bookingUrl={activeOffer?.bookingUrl || projects[0]?.bookingUrl || ""}
        />

        <Divider label="Kiküldés időzítése" />
        <SegmentedControl
          fullWidth
          size="xs"
          value={scheduleMode}
          onChange={(v) => setScheduleMode(v as "now" | "auto_random" | "custom")}
          data={[
            { value: "now", label: "Azonnali küldés" },
            {
              value: "auto_random",
              label: `Random munkaidőben (${settings.autoReplyMinDelayMin}–${settings.autoReplyMaxDelayMin} p)`,
            },
            { value: "custom", label: "Egyedi időpont" },
          ]}
        />
        {scheduleMode === "custom" && (
          <TextInput
            type="datetime-local"
            size="xs"
            label="Kiküldés időpontja"
            value={customTime}
            onChange={(e) => setCustomTime(e.currentTarget.value)}
          />
        )}

        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onClose}>
            Mégse
          </Button>
          {scheduleMode === "now" ? (
            <>
              <Button
                variant="default"
                leftSection={<IconTestPipe size={14} />}
                loading={sending}
                disabled={!activeLead || !body.trim()}
                onClick={() => handleSend(true)}
              >
                Szimulált küldés
              </Button>
              <Button
                leftSection={<IconSend size={14} />}
                loading={sending}
                disabled={!activeLead || !body.trim()}
                onClick={() => handleSend(false)}
              >
                Küldés most (SMTP / SES)
              </Button>
            </>
          ) : (
            <Button
              leftSection={<IconClock size={14} />}
              loading={sending}
              disabled={!activeLead || !body.trim()}
              onClick={() => handleSend(false)}
            >
              Üzenet időzítése
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}

function BoxWithQuickLinks({
  body,
  onChange,
  landingUrl,
  bookingUrl,
}: {
  body: string;
  onChange: (v: string) => void;
  landingUrl: string;
  bookingUrl: string;
}) {
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="xs" fw={500}>
          Levél szövege (manuálisan szerkeszthető)
        </Text>
        <Group gap={6}>
          {landingUrl && (
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconWorld size={12} />}
              onClick={() =>
                onChange(body ? `${body}\n\nRészletek: ${landingUrl}` : `Részletek: ${landingUrl}`)
              }
            >
              + Weboldal
            </Button>
          )}
          {bookingUrl && (
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconCalendarEvent size={12} />}
              onClick={() =>
                onChange(
                  body
                    ? `${body}\n\nIdőpontfoglalás: ${bookingUrl}`
                    : `Itt tud időpontot választani: ${bookingUrl}`
                )
              }
            >
              + Foglaló link
            </Button>
          )}
        </Group>
      </Group>
      <Textarea
        minRows={8}
        value={body}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder="Írd meg manuálisan a levelet, vagy kattints felül az AI levél írása gombra..."
      />
    </Stack>
  );
}
