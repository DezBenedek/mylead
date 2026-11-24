import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
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
  IconCheck,
  IconDatabase,
  IconDownload,
  IconEdit,
  IconMail,
  IconPlus,
  IconRefresh,
  IconTerminal2,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { api, formatShortDate } from "../lib/api";
import type {
  AiModelOption,
  AppSettings,
  DiscoveryToolStatus,
  LocalCliStatus,
  SenderAccount,
  SuppressionEntry,
} from "../types";

const FALLBACK_DECISION_MODELS: AiModelOption[] = [
  { id: "typesafe/jev-1.14", label: "TypeSafe Jev 1.14 (ajánlott)" },
  { id: "~typesafe/jev-latest", label: "TypeSafe Jev (latest)" },
  { id: "cloudflare/clef-flash", label: "Cloudflare Clef Flash (gyors)" },
  { id: "liquid/d1.2", label: "Liquid D1.2" },
  { id: "google/gemini-decision-1", label: "Google Gemini Decision 1" },
];

interface Props {
  settings: AppSettings;
  senderAccounts: SenderAccount[];
  suppressions: SuppressionEntry[];
  onRefresh: () => Promise<void>;
}

const emptyAccount = {
  id: null as string | null,
  name: "",
  provider: "smtp",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  mailboxEmail: "",
  smtpHost: "smtp.gmail.com",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  smtpSecurity: "starttls",
  sesRegion: "eu-central-1",
  sesAccessKey: "",
  sesSecretKey: "",
  dailyLimit: 50,
  imapHost: "imap.gmail.com",
  imapPort: 993,
  imapUsername: "",
  imapPassword: "",
  imapEnabled: false,
  isDefault: true,
};

export function SettingsPage({
  settings,
  senderAccounts,
  suppressions,
  onRefresh,
}: Props) {
  const [form, setForm] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [localClis, setLocalClis] = useState<LocalCliStatus[]>([]);
  const [probingClis, setProbingClis] = useState(false);
  const [discoveryTools, setDiscoveryTools] = useState<DiscoveryToolStatus[]>([]);
  const [installingScraper, setInstallingScraper] = useState(false);
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [decisionModelOptions, setDecisionModelOptions] = useState<AiModelOption[]>([]);
  const [loadingDecisionModels, setLoadingDecisionModels] = useState(false);

  const [accModalOpen, setAccModalOpen] = useState(false);
  const [accForm, setAccForm] = useState(emptyAccount);
  const [testEmailTarget, setTestEmailTarget] = useState("");
  const [sendingTestId, setSendingTestId] = useState<string | null>(null);

  const [newSupEmail, setNewSupEmail] = useState("");
  const [newSupReason, setNewSupReason] = useState("Kézi tiltás");
  const [exportingDb, setExportingDb] = useState(false);
  const [importingDb, setImportingDb] = useState(false);
  const [clearingDb, setClearingDb] = useState(false);
  const [lastBackupInfo, setLastBackupInfo] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const lastServerSettingsJsonRef = useRef<string>(JSON.stringify(settings));
  const latestFormRef = useRef<AppSettings>(form);
  const isEditingRef = useRef<boolean>(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestFormRef.current = form;

  // Only sync from parent settings if the user is NOT actively editing in SettingsPage
  useEffect(() => {
    if (isEditingRef.current) return;
    const incomingJson = JSON.stringify(settings);
    if (incomingJson !== lastServerSettingsJsonRef.current) {
      lastServerSettingsJsonRef.current = incomingJson;
      setForm(settings);
    }
  }, [settings]);

  // Automatic debounced save (500ms after typing stops) + flush on unmount so user edits are NEVER lost or reverted!
  useEffect(() => {
    const currentJson = JSON.stringify(form);
    if (currentJson === lastServerSettingsJsonRef.current) {
      return;
    }
    isEditingRef.current = true;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        const snapshot = latestFormRef.current;
        const saved = await api.saveSettings(snapshot);
        lastServerSettingsJsonRef.current = JSON.stringify(saved);
        isEditingRef.current = false;
        await onRefresh();
      } catch {
        isEditingRef.current = false;
      }
    }, 500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [form, onRefresh]);

  useEffect(() => {
    return () => {
      if (JSON.stringify(latestFormRef.current) !== lastServerSettingsJsonRef.current) {
        api.saveSettings(latestFormRef.current).then(() => onRefresh()).catch(() => {});
      }
    };
  }, [onRefresh]);

  const refreshLocalClis = async () => {
    setProbingClis(true);
    try {
      const [clis, dtools] = await Promise.all([
        api.detectLocalAiClis(),
        api.detectDiscoveryTools(),
      ]);
      setLocalClis(clis);
      setDiscoveryTools(dtools);
    } catch {
      setLocalClis([]);
    } finally {
      setProbingClis(false);
    }
  };

  const handleInstallGmapsScraper = async () => {
    setInstallingScraper(true);
    try {
      const msg = await api.installGmapsScraper();
      await refreshLocalClis();
      notifications.show({
        title: "Open-Source Google Maps Scraper telepítve!",
        message: msg,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Telepítési hiba", message: String(e), color: "red" });
    } finally {
      setInstallingScraper(false);
    }
  };

  useEffect(() => {
    refreshLocalClis();
  }, []);

  const handleFetchModels = async (overrideSettings?: AppSettings) => {
    const target = overrideSettings || form;
    setLoadingModels(true);
    try {
      const list = await api.fetchAiModels(target);
      setModelOptions(list);
      notifications.show({
        title: "Modellek betöltve",
        message: `${list.length} választható modell érkezett (${target.aiProvider}).`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Modell lekérési hiba", message: String(e), color: "orange" });
    } finally {
      setLoadingModels(false);
    }
  };

  const baseDecisionModels = decisionModelOptions.length > 0 ? decisionModelOptions : FALLBACK_DECISION_MODELS;
  const decisionModelSelectData: { value: string; label: string }[] = baseDecisionModels.map((m) => ({
    value: m.id,
    label: m.label,
  }));
  if (
    form.decisionModelId &&
    !decisionModelSelectData.some((m) => m.value === form.decisionModelId)
  ) {
    decisionModelSelectData.unshift({
      value: form.decisionModelId,
      label: form.decisionModelId,
    });
  }

  const handleFetchDecisionModels = async () => {
    setLoadingDecisionModels(true);
    try {
      const list = await api.fetchDecisionModels();
      setDecisionModelOptions(list);
      notifications.show({
        title: "Döntési modellek betöltve",
        message: `${list.length} döntési modell érkezett az OpenRouterról.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({
        title: "Döntési modell lekérési hiba",
        message: String(e),
        color: "orange",
      });
    } finally {
      setLoadingDecisionModels(false);
    }
  };

  const applyProvider = (prov: string, cliPath?: string) => {
    const defaultModels: Record<string, string> = {
      openrouter: "openai/gpt-4o-mini",
      opencode_go: "glm-5",
      claude_cli: "sonnet",
      codex_cli: "",
      opencode_cli: "",
      openai: "gpt-4o-mini",
      anthropic: "claude-sonnet-4-5",
      gemini: "gemini-2.5-flash",
      ollama: "llama3.1",
      local_heuristic: "local",
    };
    const next: AppSettings = {
      ...form,
      aiProvider: prov,
      aiModel: defaultModels[prov] ?? "",
      aiBaseUrl: "",
      aiCliPath: cliPath !== undefined ? cliPath : form.aiCliPath,
    };
    setForm(next);
    setModelOptions([]);
  };

  const handleSaveSettings = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    setSaving(true);
    try {
      const saved = await api.saveSettings(form);
      lastServerSettingsJsonRef.current = JSON.stringify(saved);
      isEditingRef.current = false;
      setForm(saved);
      await onRefresh();
      notifications.show({ title: "Beállítások mentve", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Mentési hiba", message: String(e), color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    setTestingAi(true);
    try {
      const msg = await api.testAiSettings(form);
      notifications.show({ title: "AI Teszt", message: msg, color: "forest" });
    } catch (e) {
      notifications.show({ title: "AI Kapcsolati hiba", message: String(e), color: "red" });
    } finally {
      setTestingAi(false);
    }
  };

  const openEditAccount = (acc: SenderAccount) => {
    setAccForm({
      id: acc.id,
      name: acc.name,
      provider: acc.provider,
      fromName: acc.fromName,
      fromEmail: acc.fromEmail,
      replyTo: acc.replyTo,
      mailboxEmail: acc.mailboxEmail || acc.fromEmail,
      smtpHost: acc.smtpHost,
      smtpPort: acc.smtpPort,
      smtpUsername: acc.smtpUsername,
      smtpPassword: acc.smtpPassword,
      smtpSecurity: acc.smtpSecurity,
      sesRegion: acc.sesRegion,
      sesAccessKey: acc.sesAccessKey,
      sesSecretKey: acc.sesSecretKey,
      dailyLimit: acc.dailyLimit,
      imapHost: acc.imapHost,
      imapPort: acc.imapPort,
      imapUsername: acc.imapUsername,
      imapPassword: acc.imapPassword,
      imapEnabled: acc.imapEnabled,
      isDefault: acc.isDefault,
    });
    setAccModalOpen(true);
  };

  const handleSaveAccount = async () => {
    if (!accForm.name.trim() || !accForm.mailboxEmail.trim()) {
      notifications.show({
        title: "Hiányzó adatok",
        message: "Add meg a fiók nevét és a postafiók e-mail címét!",
        color: "red",
      });
      return;
    }
    if (accForm.provider === "ses" && !accForm.fromEmail.trim()) {
      notifications.show({
        title: "Hiányzó SES feladó",
        message: "Külön SES küldésnél add meg az SES feladó e-mail címet is!",
        color: "red",
      });
      return;
    }
    try {
      await api.saveSenderAccount(accForm);
      await onRefresh();
      setAccModalOpen(false);
      notifications.show({ title: "Küldő fiók mentve", message: accForm.name, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const handleSendTest = async (accountId: string) => {
    if (!testEmailTarget.trim()) {
      notifications.show({
        title: "Címzett szükséges",
        message: "Írd be a teszt e-mail címzettjét felül!",
        color: "orange",
      });
      return;
    }
    setSendingTestId(accountId);
    try {
      const res = await api.sendTestEmail(accountId, testEmailTarget.trim());
      notifications.show({ title: "Teszt levél elküldve", message: res, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Küldési hiba", message: String(e), color: "red" });
    } finally {
      setSendingTestId(null);
    }
  };

  const handleAddSuppression = async () => {
    if (!newSupEmail.trim()) return;
    await api.addSuppression(newSupEmail.trim(), newSupReason.trim());
    setNewSupEmail("");
    await onRefresh();
  };

  const describeBackupJson = (json: string): string => {
    try {
      const parsed = JSON.parse(json);
      const tables = parsed?.tables;
      if (!tables || typeof tables !== "object") return "";
      const pick = (k: string) =>
        Array.isArray(tables[k]) ? (tables[k] as unknown[]).length : 0;
      return [
        `${pick("projects")} projekt`,
        `${pick("searches")} keresés`,
        `${pick("leads")} cég`,
        `${pick("campaigns")} kampány`,
        `${pick("email_messages")} levél`,
      ].join(" • ");
    } catch {
      return "";
    }
  };

  const handleExportDatabase = async () => {
    setExportingDb(true);
    try {
      const json = await api.exportDatabase();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mylead-adatbazis-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const info = describeBackupJson(json);
      setLastBackupInfo(
        `${(blob.size / 1024).toFixed(1)} KB${info ? ` — ${info}` : ""}`
      );
      notifications.show({
        title: "Adatbázis mentés letöltve",
        message: info || "A teljes munkaterület JSON-be mentve.",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Export hiba", message: String(e), color: "red" });
    } finally {
      setExportingDb(false);
    }
  };

  const handleImportDatabaseFile = async (file: File | undefined | null) => {
    if (!file) return;
    const text = await file.text();
    if (!text.trim().startsWith("{")) {
      notifications.show({
        title: "Érvénytelen fájl",
        message: "Válassz egy korábban exportált MyLead JSON mentést!",
        color: "red",
      });
      return;
    }
    const ok = window.confirm(
      "Biztosan visszaállítod ezt a mentést? A jelenlegi adatbázis teljes tartalma lecserélődik!"
    );
    if (!ok) return;
    setImportingDb(true);
    try {
      const summary = await api.importDatabase(text);
      await onRefresh();
      setLastBackupInfo(`Visszaállítva: ${summary}`);
      notifications.show({
        title: "Adatbázis visszaállítva",
        message: summary,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Import hiba", message: String(e), color: "red" });
    } finally {
      setImportingDb(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  const handleClearWorkspace = async () => {
    const ok = window.confirm(
      "Biztosan törlöd a teljes munkaterületet (projektek, keresések, leadek, kampányok, levelek)? Ez nem vonható vissza — előbb készíts JSON mentést!"
    );
    if (!ok) return;
    setClearingDb(true);
    try {
      await api.clearWorkspaceData();
      await onRefresh();
      notifications.show({ title: "Munkaterület törölve", message: "", color: "gray" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setClearingDb(false);
    }
  };

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between" align="center">
          <Title order={4} style={{ letterSpacing: "-0.02em" }}>
            Beállítások
          </Title>
          <Button
            size="xs"
            leftSection={<IconCheck size={14} />}
            loading={saving}
            onClick={handleSaveSettings}
          >
            Mentés
          </Button>
        </Group>
      </Box>

      <Box className="ml-page-body">
        <Tabs defaultValue="email">
          <Tabs.List mb="sm">
            <Tabs.Tab value="email">E-mail & IMAP</Tabs.Tab>
            <Tabs.Tab value="autoreply">Auto-válasz & Fókusz</Tabs.Tab>
            <Tabs.Tab value="ai">AI Modell</Tabs.Tab>
            <Tabs.Tab value="discovery">Keresőmotorok</Tabs.Tab>
            <Tabs.Tab value="suppression">Tiltólista ({suppressions.length})</Tabs.Tab>
            <Tabs.Tab value="database">Adatbázis</Tabs.Tab>
          </Tabs.List>

          {/* SMTP / SES / IMAP */}
          <Tabs.Panel value="email">
            <Paper p="sm">
              <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
                <Text fw={600} size="sm">
                  Küldő & IMAP fiókok ({senderAccounts.length})
                </Text>
                <Group gap="xs">
                  <TextInput
                    size="xs"
                    placeholder="Teszt címzett e-mail..."
                    value={testEmailTarget}
                    onChange={(e) => setTestEmailTarget(e.currentTarget.value)}
                    w={200}
                  />
                  <Button
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    onClick={() => {
                      setAccForm(emptyAccount);
                      setAccModalOpen(true);
                    }}
                  >
                    Új fiók
                  </Button>
                </Group>
              </Group>

                {senderAccounts.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Még nincs beállított küldő fiók.
                  </Text>
                ) : (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Fiók neve</Table.Th>
                        <Table.Th>Típus</Table.Th>
                        <Table.Th>Feladó</Table.Th>
                        <Table.Th>Szerver / Régió</Table.Th>
                        <Table.Th>IMAP</Table.Th>
                        <Table.Th ta="right">Napi kvóta</Table.Th>
                        <Table.Th ta="right">Műveletek</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {senderAccounts.map((acc) => (
                        <Table.Tr key={acc.id}>
                          <Table.Td>
                            <Group gap={6}>
                              <Text size="sm" fw={600}>
                                {acc.name}
                              </Text>
                              {acc.isDefault && (
                                <Badge size="xs" color="forest">
                                  Alapértelmezett
                                </Badge>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Badge variant="default">{acc.provider.toUpperCase()}</Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" className="ml-mono">
                              {acc.mailboxEmail || acc.fromEmail}
                            </Text>
                            {acc.provider === "ses" &&
                              acc.fromEmail !== (acc.mailboxEmail || acc.fromEmail) && (
                                <Text size="11px" c="dimmed" className="ml-mono">
                                  SES: {acc.fromEmail}
                                </Text>
                              )}
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed" className="ml-mono">
                              {acc.provider === "ses"
                                ? `AWS SES (${acc.sesRegion})`
                                : `${acc.smtpHost}:${acc.smtpPort}`}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" color={acc.imapEnabled ? "green" : "gray"}>
                              {acc.imapEnabled ? "Aktív" : "Ki"}
                            </Badge>
                          </Table.Td>
                          <Table.Td ta="right" className="ml-tabular">
                            {acc.sentToday} / {acc.dailyLimit}
                          </Table.Td>
                          <Table.Td>
                            <Group justify="flex-end" gap={6}>
                              <Button
                                size="xs"
                                variant="default"
                                leftSection={<IconMail size={13} />}
                                loading={sendingTestId === acc.id}
                                onClick={() => handleSendTest(acc.id)}
                              >
                                Teszt
                              </Button>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                onClick={() => openEditAccount(acc)}
                              >
                                <IconEdit size={14} />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={async () => {
                                  await api.deleteSenderAccount(acc.id);
                                  await onRefresh();
                                }}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
            </Paper>

            <Paper p="sm" mt="sm">
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  Szerepkörök: kampány vs. ügyféllevelezés
                </Text>
                <Text size="xs" c="dimmed">
                  Tömeges kampánylevelek: kampányonként állítható (Kampányok oldal), mehet
                  „burner" domainről (pl. SES) — ha a Google letiltja, csak az bánja.
                  Az élő ügyféllevelezés (automatikus és kézi válaszok, közvetlen
                  üzenetek) mindig az alábbi fiókról menjen a saját, védett domainedről.
                </Text>
                <Select
                  size="xs"
                  label="Válaszok küldő fiókja (1:1 levelezés)"
                  description="Pl. benedek@okosurlap.hu (SMTP). Üresen: kampányfiók → alapértelmezett → első."
                  placeholder="Nincs külön válasz-fiók"
                  clearable
                  value={form.replySenderAccountId || null}
                  onChange={(v) => setForm({ ...form, replySenderAccountId: v || null })}
                  data={senderAccounts.map((a) => ({
                    value: a.id,
                    label: `${a.name} — ${a.mailboxEmail || a.fromEmail}`,
                  }))}
                />
              </Stack>
            </Paper>
          </Tabs.Panel>

          {/* Auto-Reply & Customization (Compact 2-column layout) */}
          <Tabs.Panel value="autoreply">
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
              <Paper p="sm">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text fw={600} size="sm">
                      AI Auto-válasz időzítés
                    </Text>
                    <Switch
                      size="xs"
                      label="Aktív"
                      checked={form.autoReplyEnabled}
                      onChange={(e) =>
                        setForm({ ...form, autoReplyEnabled: e.currentTarget.checked })
                      }
                    />
                  </Group>

                  <Box>
                    <Text size="xs" fw={500} mb={4}>
                      Munkanapok
                    </Text>
                    <Group gap="xs">
                      {[
                        { day: 1, label: "H" },
                        { day: 2, label: "K" },
                        { day: 3, label: "Sze" },
                        { day: 4, label: "Cs" },
                        { day: 5, label: "P" },
                        { day: 6, label: "Szo" },
                        { day: 7, label: "V" },
                      ].map((w) => {
                        const checked = (form.autoReplyWorkdays || [1, 2, 3, 4, 5, 6]).includes(w.day);
                        return (
                          <Checkbox
                            key={w.day}
                            size="xs"
                            label={w.label}
                            checked={checked}
                            onChange={(e) => {
                              const cur = form.autoReplyWorkdays || [1, 2, 3, 4, 5, 6];
                              const next = e.currentTarget.checked
                                ? [...cur, w.day].sort()
                                : cur.filter((d) => d !== w.day);
                              setForm({ ...form, autoReplyWorkdays: next });
                            }}
                          />
                        );
                      })}
                    </Group>
                  </Box>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Munkaidő kezdete (óra)"
                      min={0}
                      max={22}
                      value={form.autoReplyStartHour}
                      onChange={(v) => setForm({ ...form, autoReplyStartHour: Number(v) || 8 })}
                    />
                    <NumberInput
                      size="xs"
                      label="Munkaidő vége (óra)"
                      min={1}
                      max={24}
                      value={form.autoReplyEndHour}
                      onChange={(v) => setForm({ ...form, autoReplyEndHour: Number(v) || 18 })}
                    />
                    <NumberInput
                      size="xs"
                      label="Min. késleltetés (perc)"
                      min={1}
                      max={720}
                      value={form.autoReplyMinDelayMin}
                      onChange={(v) => setForm({ ...form, autoReplyMinDelayMin: Number(v) || 20 })}
                    />
                    <NumberInput
                      size="xs"
                      label="Max. késleltetés (perc)"
                      min={5}
                      max={1440}
                      value={form.autoReplyMaxDelayMin}
                      onChange={(v) => setForm({ ...form, autoReplyMaxDelayMin: Number(v) || 120 })}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={3} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Automata IMAP lekérés (perc)"
                      min={1}
                      max={120}
                      value={form.imapPollMinutes || 1}
                      onChange={(v) => setForm({ ...form, imapPollMinutes: Math.max(1, Number(v) || 1) })}
                    />
                    <Select
                      size="xs"
                      label="Alap hangnem"
                      value={form.defaultTone || "professional_formal"}
                      onChange={(v) => setForm({ ...form, defaultTone: v || "professional_formal" })}
                      data={[
                        { value: "professional_formal", label: "Magázó" },
                        { value: "friendly_direct", label: "Tegező" },
                        { value: "concise_executive", label: "Tömör" },
                      ]}
                    />
                    <NumberInput
                      size="xs"
                      label="Napi limit"
                      min={1}
                      max={500}
                      value={form.defaultDailyLimit || 35}
                      onChange={(v) => setForm({ ...form, defaultDailyLimit: Number(v) || 35 })}
                    />
                  </SimpleGrid>

                  <Switch
                    size="xs"
                    label="Beérkező levelek automatikus rendezése OpenRouter Decision Model prioritás (1-100) szerint"
                    checked={form.decisionAutoSortInbox ?? true}
                    onChange={(e) =>
                      setForm({ ...form, decisionAutoSortInbox: e.currentTarget.checked })
                    }
                  />
                </Stack>
              </Paper>

              <Paper p="sm">
                <Stack gap="xs">
                  <Text fw={600} size="sm">
                    AI Fókusz (Okosűrlap) & Globális szabályok
                  </Text>
                  <Textarea
                    size="xs"
                    label="Lead-elemzési fókusz"
                    autosize
                    minRows={3}
                    maxRows={6}
                    value={form.aiAnalysisFocus || ""}
                    onChange={(e) => setForm({ ...form, aiAnalysisFocus: e.currentTarget.value })}
                  />
                  <Textarea
                    size="xs"
                    label="Globális AI auto-válasz szabályok"
                    autosize
                    minRows={2}
                    maxRows={5}
                    placeholder="pl. Válaszolj barátságosan, röviden, emeld ki az okosűrlapot..."
                    value={form.aiReplyInstructions || ""}
                    onChange={(e) =>
                      setForm({ ...form, aiReplyInstructions: e.currentTarget.value })
                    }
                  />
                  <Textarea
                    size="xs"
                    label="Alapértelmezett e-mail aláírás (fő aláírás)"
                    autosize
                    minRows={2}
                    maxRows={5}
                    value={form.companySignature}
                    onChange={(e) => setForm({ ...form, companySignature: e.currentTarget.value })}
                  />

                  <Box>
                    <Group justify="space-between" mb={4}>
                      <Text size="xs" fw={600}>
                        Apróbetűs rész az aláírás alatt (Cégadatok, adószám, székhely, jogi / GDPR szöveg)
                      </Text>
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="forest"
                        onClick={() => {
                          const tpl =
                            "OKOSűrlap • Székhely: Budapest • Web: https://okosurlap.hu\nEz egy B2B szakmai megkeresés. Amennyiben a jövőben nem szeretne tőlünk üzenetet kapni, kérjük, jelezze egy rövid válaszlevélben.";
                          setForm({
                            ...form,
                            signatureFinePrint: form.signatureFinePrint?.trim()
                              ? `${form.signatureFinePrint.trim()}\n${tpl}`
                              : tpl,
                          });
                        }}
                      >
                        + Cégadatok & GDPR sablon beszúrása
                      </Button>
                    </Group>
                    <Textarea
                      size="xs"
                      placeholder="pl. Cégnév Kft. | Székhely: 1051 Budapest, Példa u. 1. | Adószám: 12345678-2-41 | Cégjegyzékszám: 01-09-123456&#10;Amennyiben nem szeretne további megkeresést kapni, válaszoljon 'Leiratkozás' üzenettel."
                      autosize
                      minRows={2}
                      maxRows={5}
                      value={form.signatureFinePrint || ""}
                      onChange={(e) =>
                        setForm({ ...form, signatureFinePrint: e.currentTarget.value })
                      }
                    />
                    <Text size="11px" c="dimmed" mt={3}>
                      Kiküldéskor az e-mail végén, egy elválasztó vonal alatt automatikusan{" "}
                      <strong>apróbetűs (11px, halványszürke)</strong> formázással jelenik meg a
                      címzett postafiókjában.
                    </Text>
                  </Box>

                  {/* Live Signature & Fine Print Preview */}
                  <Paper
                    p="xs"
                    style={{
                      backgroundColor: "var(--ml-canvas)",
                      border: "1px dashed var(--ml-border-strong)",
                    }}
                  >
                    <Text size="10px" tt="uppercase" fw={700} c="dimmed" mb={4}>
                      Élő aláírás előnézet (ahogy a kiküldött levél alján megjelenik):
                    </Text>
                    <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {form.companySignature || "Üdvözlettel,\nMyLead Csapat"}
                    </Text>
                    {(form.signatureFinePrint || "").trim() && (
                      <Box
                        mt={8}
                        pt={6}
                        style={{
                          borderTop: "1px solid var(--ml-border)",
                          fontSize: "11px",
                          lineHeight: 1.4,
                          color: "var(--mantine-color-dimmed)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {form.signatureFinePrint}
                      </Box>
                    )}
                  </Paper>
                </Stack>
              </Paper>
            </SimpleGrid>
          </Tabs.Panel>

          {/* AI Settings */}
          <Tabs.Panel value="ai">
            <Stack gap="sm" maw={920}>
              {/* Installed Local CLIs Card */}
              <Paper p="sm">
                <Group justify="space-between" mb="xs">
                  <Group gap={6}>
                    <IconTerminal2 size={15} />
                    <Text fw={600} size="sm">
                      Telepített AI CLI-k (API kulcs nélkül)
                    </Text>
                  </Group>
                  <Button
                    size="compact-xs"
                    variant="default"
                    leftSection={<IconRefresh size={12} />}
                    loading={probingClis}
                    onClick={refreshLocalClis}
                  >
                    Frissítés
                  </Button>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  {localClis.map((cli) => {
                    const isSelected = form.aiProvider === cli.id;
                    return (
                      <Paper
                        key={cli.id}
                        p="xs"
                        style={{
                          borderColor: isSelected ? "#166534" : undefined,
                          backgroundColor: isSelected ? "var(--ml-canvas)" : undefined,
                        }}
                      >
                        <Group justify="space-between" wrap="nowrap" align="flex-start">
                          <Box style={{ minWidth: 0 }}>
                            <Group gap={6} wrap="nowrap">
                              <Text size="xs" fw={600} truncate>
                                {cli.name}
                              </Text>
                              <Badge size="xs" color={cli.installed ? "green" : "gray"}>
                                {cli.installed ? "Telepítve" : "Hiányzik"}
                              </Badge>
                            </Group>
                            <Text size="11px" c="dimmed" className="ml-mono" truncate mt={2}>
                              {cli.installed ? `${cli.version} • ${cli.path}` : `Nem található (${cli.binary})`}
                            </Text>
                          </Box>
                          {cli.installed && (
                            <Button
                              size="compact-xs"
                              variant={isSelected ? "filled" : "default"}
                              onClick={() => applyProvider(cli.id, cli.path)}
                            >
                              {isSelected ? "Aktív" : "Használat"}
                            </Button>
                          )}
                        </Group>
                      </Paper>
                    );
                  })}
                </SimpleGrid>
              </Paper>

              {/* Main AI Provider Configuration */}
              <Paper p="sm">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text fw={600} size="sm">
                      AI Szolgáltató & Modell
                    </Text>
                    <Button size="compact-xs" variant="default" loading={testingAi} onClick={handleTestAi}>
                      Kapcsolat tesztelése
                    </Button>
                  </Group>

                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select
                      label="AI Szolgáltató / Motor"
                      value={form.aiProvider}
                      onChange={(v) => applyProvider(v || "openrouter")}
                      data={[
                        {
                          group: "Router & Subscription API-k",
                          items: [
                            { value: "openrouter", label: "OpenRouter API (openrouter.ai)" },
                            { value: "opencode_go", label: "OpenCode Go API (opencode.ai/zen/go/v1)" },
                          ],
                        },
                        {
                          group: "Gépemre telepített CLI-k (API kulcs nélkül)",
                          items: [
                            { value: "claude_cli", label: "Claude Code CLI (Anthropic / claude)" },
                            { value: "codex_cli", label: "Codex CLI (OpenAI / codex exec)" },
                            { value: "opencode_cli", label: "OpenCode CLI (opencode run)" },
                            { value: "ollama", label: "Ollama (Lokális szerver)" },
                          ],
                        },
                        {
                          group: "Közvetlen Cloud API-k",
                          items: [
                            { value: "openai", label: "OpenAI API (GPT)" },
                            { value: "anthropic", label: "Anthropic API (Claude)" },
                            { value: "gemini", label: "Google Gemini API" },
                            { value: "local_heuristic", label: "Lokális heurisztikus mód (AI nélkül)" },
                          ],
                        },
                      ]}
                    />

                    <Box>
                      <Group justify="space-between" mb={4}>
                        <Text size="sm" fw={500}>
                          Modell azonosító
                        </Text>
                        {form.aiProvider !== "local_heuristic" && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<IconRefresh size={12} />}
                            loading={loadingModels}
                            onClick={() => handleFetchModels()}
                          >
                            Modellek lekérése
                          </Button>
                        )}
                      </Group>
                      <TextInput
                        placeholder={
                          form.aiProvider === "claude_cli"
                            ? "sonnet, opus, haiku (vagy üres = alapértelmezett)"
                            : form.aiProvider === "codex_cli"
                            ? "pl. gpt-5.4 vagy üres = ~/.codex/config.toml"
                            : form.aiProvider === "opencode_cli"
                            ? "pl. opencode-go/glm-5 vagy üres = alapértelmezett"
                            : form.aiProvider === "opencode_go"
                            ? "pl. glm-5, kimi-k2.5, deepseek-chat"
                            : "pl. openai/gpt-4o-mini vagy anthropic/claude-sonnet-4"
                        }
                        value={form.aiModel}
                        onChange={(e) => setForm({ ...form, aiModel: e.currentTarget.value })}
                      />
                    </Box>
                  </SimpleGrid>

                  {modelOptions.length > 0 && (
                    <Select
                      label={`Elérhető modellek (${modelOptions.length}) — kereshető lista`}
                      placeholder="Válassz egy modellt a betöltött listából..."
                      searchable
                      clearable
                      value={form.aiModel || null}
                      onChange={(v) => setForm({ ...form, aiModel: v ?? "" })}
                      data={modelOptions.map((m) => ({ value: m.id, label: m.label }))}
                    />
                  )}

                  {!["local_heuristic", "ollama", "claude_cli", "codex_cli", "opencode_cli"].includes(
                    form.aiProvider
                  ) && (
                    <PasswordInput
                      label={
                        form.aiProvider === "openrouter"
                          ? "OpenRouter API kulcs (sk-or-v1-...)"
                          : form.aiProvider === "opencode_go"
                          ? "OpenCode Go API kulcs"
                          : "API kulcs"
                      }
                      placeholder={
                        form.aiProvider === "openrouter"
                          ? "sk-or-v1-..."
                          : form.aiProvider === "opencode_go"
                          ? "OpenCode API kulcs..."
                          : "sk-..."
                      }
                      value={form.aiApiKey}
                      onChange={(e) => setForm({ ...form, aiApiKey: e.currentTarget.value })}
                    />
                  )}

                  {["claude_cli", "codex_cli", "opencode_cli"].includes(form.aiProvider) ? (
                    <TextInput
                      label="CLI bináris útvonala (opcionális — üresen hagyva automatikusan felismeri)"
                      placeholder={
                        form.aiProvider === "claude_cli"
                          ? "/opt/homebrew/bin/claude"
                          : form.aiProvider === "codex_cli"
                          ? "/opt/homebrew/bin/codex"
                          : "~/.opencode/bin/opencode"
                      }
                      value={form.aiCliPath}
                      onChange={(e) => setForm({ ...form, aiCliPath: e.currentTarget.value })}
                    />
                  ) : (
                    form.aiProvider !== "local_heuristic" && (
                      <TextInput
                        label="Egyedi Base URL (opcionális)"
                        placeholder={
                          form.aiProvider === "openrouter"
                            ? "Alapértelmezett: https://openrouter.ai/api/v1"
                            : form.aiProvider === "opencode_go"
                            ? "Alapértelmezett: https://opencode.ai/zen/go/v1"
                            : form.aiProvider === "ollama"
                            ? "Alapértelmezett: http://127.0.0.1:11434"
                            : "Alapértelmezett végpont használata"
                        }
                        value={form.aiBaseUrl}
                        onChange={(e) => setForm({ ...form, aiBaseUrl: e.currentTarget.value })}
                      />
                    )
                  )}
                </Stack>
              </Paper>

              {/* OpenRouter Decisions API — Decision Model for inbound email ranking & tagging */}
              <Paper p="sm" style={{ borderColor: "#166534" }}>
                <Stack gap="xs">
                  <Group justify="space-between" wrap="wrap">
                    <Box>
                      <Group gap={6}>
                        <Text fw={700} size="sm">
                          OpenRouter Decisions API — döntő modell (beérkező e-mail rangsorolás & címkézés)
                        </Text>
                        <Badge size="xs" color="forest">
                          choice · score · noul
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" mt={2}>
                        A Decisions API típusos döntéseket ad vissza szöveg helyett: szándék (choice),
                        prioritás (score + choice), címkék (noul). Az ajánlott válasz szövegét a helyi
                        válaszépítő állítja elő, mert a döntési modellek nem írnak szöveget.
                      </Text>
                    </Box>
                    <Switch
                      size="xs"
                      label="Automata prioritás-sorrend"
                      checked={form.decisionAutoSortInbox ?? true}
                      onChange={(e) =>
                        setForm({ ...form, decisionAutoSortInbox: e.currentTarget.checked })
                      }
                    />
                  </Group>

                  <Select
                    size="xs"
                    label="Döntési API mód"
                    value={form.decisionModelApi || "decisions"}
                    onChange={(v) =>
                      setForm({
                        ...form,
                        decisionModelProvider: "openrouter",
                        decisionModelApi: v || "decisions",
                      })
                    }
                    data={[
                      { value: "decisions", label: "Decisions API (ajánlott — típusos döntések)" },
                      { value: "chat", label: "Chat Completions + Structured Outputs (régi mód)" },
                    ]}
                  />

                  <Group align="flex-end" gap="xs" wrap="wrap">
                    <Select
                      size="xs"
                      label="Döntési modell (OpenRouter Decisions modell)"
                      searchable
                      style={{ flex: 1, minWidth: 260 }}
                      value={form.decisionModelId || "typesafe/jev-1.14"}
                      onChange={(v) =>
                        setForm({
                          ...form,
                          decisionModelProvider: "openrouter",
                          decisionModelId: v || "typesafe/jev-1.14",
                        })
                      }
                      data={decisionModelSelectData}
                    />
                    <Button
                      size="xs"
                      variant="default"
                      loading={loadingDecisionModels}
                      onClick={handleFetchDecisionModels}
                    >
                      Modellek frissítése
                    </Button>
                  </Group>

                  <TextInput
                    size="xs"
                    label="Egyedi döntési modell azonosító"
                    description="Bármely OpenRouter döntési modell slugja. A lista a /api/v1/models?output_modalities=decisions végpontról jön."
                    placeholder="pl. typesafe/jev-1.14 vagy cloudflare/clef-flash"
                    value={form.decisionModelId || "typesafe/jev-1.14"}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        decisionModelProvider: "openrouter",
                        decisionModelId: e.currentTarget.value,
                      })
                    }
                  />

                  <PasswordInput
                    size="xs"
                    label="OpenRouter API kulcs a döntő modellhez (sk-or-v1-...)"
                    description="Itt állítsd be az API kulcsot (https://openrouter.ai/keys). Ha üresen hagyod és a fő AI szolgáltatód is OpenRouter, automatikusan a fenti OpenRouter API kulcsot használja."
                    placeholder="sk-or-v1-... (vagy üres = fő OpenRouter kulcs használata)"
                    value={form.decisionModelApiKey || ""}
                    onChange={(e) =>
                      setForm({ ...form, decisionModelApiKey: e.currentTarget.value })
                    }
                  />
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* Discovery APIs & Open-Source Scrapers */}
          <Tabs.Panel value="discovery">
            <Stack gap="sm" maw={920}>
              <Paper p="sm">
                <Group justify="space-between" mb="xs">
                  <Text fw={600} size="sm">
                    Keresőmotorok & Scraper állapot
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="default"
                    leftSection={<IconRefresh size={12} />}
                    loading={probingClis}
                    onClick={refreshLocalClis}
                  >
                    Frissítés
                  </Button>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  {discoveryTools.map((tool) => (
                    <Paper key={tool.id} p="xs">
                      <Group justify="space-between" wrap="nowrap">
                        <Box style={{ minWidth: 0 }}>
                          <Group gap={6} wrap="nowrap">
                            <Text size="xs" fw={600} truncate>
                              {tool.name}
                            </Text>
                            <Badge size="xs" color={tool.available ? "green" : "gray"}>
                              {tool.available ? "Kész" : "Hiányzik"}
                            </Badge>
                          </Group>
                          <Text size="11px" c="dimmed" truncate mt={2}>
                            {tool.detail}
                          </Text>
                        </Box>
                        {tool.installable && (
                          <Button
                            size="compact-xs"
                            leftSection={<IconDownload size={12} />}
                            loading={installingScraper}
                            onClick={handleInstallGmapsScraper}
                          >
                            Telepítés
                          </Button>
                        )}
                      </Group>
                    </Paper>
                  ))}
                </SimpleGrid>
              </Paper>

              <Paper p="sm">
                <Stack gap="xs">
                  <Text fw={600} size="sm">
                    Keresőmotor beállítások & API kulcsok
                  </Text>

                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select
                      label="CLI beépített webkereső preferált motorja"
                      value={form.cliSearchEngine || "auto"}
                      onChange={(v) => setForm({ ...form, cliSearchEngine: v || "auto" })}
                      data={[
                        { value: "auto", label: "Automatikus (OpenCode → Claude → Codex)" },
                        { value: "opencode", label: "OpenCode CLI webkereső" },
                        { value: "claude", label: "Claude Code CLI (WebSearch)" },
                        { value: "codex", label: "Codex CLI (--search)" },
                      ]}
                    />
                    <TextInput
                      label="SearXNG URL (opcionális, nyílt meta-kereső)"
                      placeholder="pl. http://localhost:8080 vagy https://searx.domain.hu"
                      value={form.searxngUrl || ""}
                      onChange={(e) => setForm({ ...form, searxngUrl: e.currentTarget.value })}
                    />
                  </SimpleGrid>

                  <TextInput
                    label="google-maps-scraper bináris útvonala (opcionális — alapértelmezett: ~/go/bin/google-maps-scraper)"
                    placeholder="Üresen hagyva automatikusan felismeri"
                    value={form.gmapsScraperPath || ""}
                    onChange={(e) =>
                      setForm({ ...form, gmapsScraperPath: e.currentTarget.value })
                    }
                  />

                  <Divider label="Opcionális fizetős Google Maps API kulcsok" />

                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <PasswordInput
                      label="Google Places API kulcs (Places API New)"
                      placeholder="AIza..."
                      value={form.googlePlacesApiKey}
                      onChange={(e) =>
                        setForm({ ...form, googlePlacesApiKey: e.currentTarget.value })
                      }
                    />
                    <PasswordInput
                      label="Serper.dev API kulcs (Google Maps / Search)"
                      placeholder="serper API key..."
                      value={form.serperApiKey}
                      onChange={(e) => setForm({ ...form, serperApiKey: e.currentTarget.value })}
                    />
                  </SimpleGrid>

                  <Group justify="flex-end">
                    <Button loading={saving} onClick={handleSaveSettings}>
                      Keresési beállítások mentése
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* Suppression List */}
          <Tabs.Panel value="suppression">
            <Paper p="md" maw={760}>
              <Stack gap="sm">
                <Text fw={600} size="sm">
                  Globális tiltólista (Leiratkozottak / Do-Not-Contact)
                </Text>
                <Text size="xs" c="dimmed">
                  Az itt szereplő e-mail címekre a MyLead soha nem küld kampánylevelet. Ha egy
                  beérkező válaszban leiratkozást érzékel az AI, automatikusan ide kerül.
                </Text>
                <Group align="flex-end">
                  <TextInput
                    label="E-mail cím"
                    placeholder="pelda@ceg.hu"
                    value={newSupEmail}
                    onChange={(e) => setNewSupEmail(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    label="Ok"
                    value={newSupReason}
                    onChange={(e) => setNewSupReason(e.currentTarget.value)}
                    w={200}
                  />
                  <Button onClick={handleAddSuppression}>Tiltólistára tesz</Button>
                </Group>

                {suppressions.length > 0 && (
                  <Table mt="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>E-mail</Table.Th>
                        <Table.Th>Ok</Table.Th>
                        <Table.Th>Dátum</Table.Th>
                        <Table.Th ta="right">Törlés</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {suppressions.map((s) => (
                        <Table.Tr key={s.email}>
                          <Table.Td className="ml-mono">{s.email}</Table.Td>
                          <Table.Td>{s.reason}</Table.Td>
                          <Table.Td className="ml-tabular">{formatShortDate(s.createdAt)}</Table.Td>
                          <Table.Td ta="right">
                            <ActionIcon
                              size="sm"
                              color="red"
                              variant="subtle"
                              onClick={async () => {
                                await api.removeSuppression(s.email);
                                await onRefresh();
                              }}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Stack>
            </Paper>
          </Tabs.Panel>

          {/* Full database backup (JSON export / import) */}
          <Tabs.Panel value="database">
            <Stack gap="sm" maw={760}>
              <Paper p="md">
                <Stack gap="sm">
                  <Group gap={8}>
                    <IconDatabase size={16} />
                    <Text fw={600} size="sm">
                      Teljes adatbázis mentés (JSON)
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    A mentés tartalmaz mindent: projektek + ajánlatok, keresések,
                    leadek (+ kereső–lead kapcsolatok), kampányok, e-mail üzenetek,
                    küldő fiókok, tiltólista, beállítások és aktivitásnapló. Az
                    import a jelenlegi adatbázist teljesen lecseréli (az azonosítók
                    megmaradnak, így a kapcsolatok sem törnek meg).
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    <Button
                      size="xs"
                      leftSection={<IconDownload size={14} />}
                      loading={exportingDb}
                      onClick={handleExportDatabase}
                    >
                      Mentés letöltése (JSON)
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconUpload size={14} />}
                      loading={importingDb}
                      onClick={() => importFileRef.current?.click()}
                    >
                      Mentés visszaállítása
                    </Button>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json,application/json"
                      hidden
                      onChange={(e) => handleImportDatabaseFile(e.currentTarget.files?.[0])}
                    />
                  </Group>
                  {lastBackupInfo && (
                    <Text size="xs" c="dimmed" className="ml-mono">
                      {lastBackupInfo}
                    </Text>
                  )}
                </Stack>
              </Paper>

              <Paper p="md" style={{ borderColor: "var(--ml-border-strong)" }}>
                <Stack gap="xs">
                  <Text fw={600} size="sm" c="red">
                    Veszélyes zóna
                  </Text>
                  <Text size="xs" c="dimmed">
                    A teljes munkaterület törlése (projektek, keresések, leadek,
                    kampányok, levelek). A küldő fiókok és beállítások megmaradnak.
                    Visszavonhatatlan — előbb készíts JSON mentést!
                  </Text>
                  <Group>
                    <Button
                      size="xs"
                      variant="outline"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      loading={clearingDb}
                      onClick={handleClearWorkspace}
                    >
                      Munkaterület törlése
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Box>

      {/* Sender Account Modal */}
      <Modal
        opened={accModalOpen}
        onClose={() => setAccModalOpen(false)}
        title={accForm.id ? "E-mail küldő szerkesztése" : "Új e-mail küldő"}
        size="lg"
      >
        <Stack gap="sm">
          {/* 1. rész: a postafiók */}
          <Paper p="sm" withBorder>
            <Stack gap="xs">
              <Text fw={600} size="sm">
                1. Postafiók <Text span size="xs" c="dimmed" fw={400}>— ide jönnek a válaszok, innen olvas az app</Text>
              </Text>
              <SimpleGrid cols={2}>
                <TextInput
                  label="Fiók megnevezése"
                  placeholder="pl. Saját postafiók / AWS SES burner"
                  required
                  value={accForm.name}
                  onChange={(e) => setAccForm({ ...accForm, name: e.currentTarget.value })}
                />
                <NumberInput
                  label="Napi küldési limit"
                  min={1}
                  max={10000}
                  value={accForm.dailyLimit}
                  onChange={(v) => setAccForm({ ...accForm, dailyLimit: Number(v) || 50 })}
                />
              </SimpleGrid>
              <SimpleGrid cols={2}>
                <TextInput
                  label="Feladó neve"
                  placeholder="Kovács Márton"
                  value={accForm.fromName}
                  onChange={(e) => setAccForm({ ...accForm, fromName: e.currentTarget.value })}
                />
                <TextInput
                  label="Postafiók e-mail címe"
                  description="Válaszcím automatikusan ez — külön nem kell beállítani."
                  placeholder="benedek@okosurlap.hu"
                  required
                  value={accForm.mailboxEmail}
                  onChange={(e) => setAccForm({ ...accForm, mailboxEmail: e.currentTarget.value })}
                />
              </SimpleGrid>
              <SimpleGrid cols={3}>
                <TextInput
                  label="SMTP Host"
                  placeholder="smtp.gmail.com"
                  value={accForm.smtpHost}
                  onChange={(e) => setAccForm({ ...accForm, smtpHost: e.currentTarget.value })}
                />
                <NumberInput
                  label="Port"
                  value={accForm.smtpPort}
                  onChange={(v) => setAccForm({ ...accForm, smtpPort: Number(v) || 587 })}
                />
                <Select
                  label="Titkosítás"
                  value={accForm.smtpSecurity}
                  onChange={(v) => setAccForm({ ...accForm, smtpSecurity: v || "starttls" })}
                  data={[
                    { value: "starttls", label: "STARTTLS (587)" },
                    { value: "tls", label: "SSL / TLS (465)" },
                    { value: "none", label: "Nincs (teszt)" },
                  ]}
                />
              </SimpleGrid>
              <SimpleGrid cols={2}>
                <TextInput
                  label="SMTP Felhasználónév"
                  value={accForm.smtpUsername}
                  onChange={(e) => setAccForm({ ...accForm, smtpUsername: e.currentTarget.value })}
                />
                <PasswordInput
                  label="SMTP Jelszó / App Password"
                  value={accForm.smtpPassword}
                  onChange={(e) => setAccForm({ ...accForm, smtpPassword: e.currentTarget.value })}
                />
              </SimpleGrid>
              <Switch
                label="IMAP beérkező levelek figyelése erről a postafiókról"
                checked={accForm.imapEnabled}
                onChange={(e) => setAccForm({ ...accForm, imapEnabled: e.currentTarget.checked })}
              />
              {accForm.imapEnabled && (
                <SimpleGrid cols={2}>
                  <TextInput
                    label="IMAP Host"
                    placeholder="imap.gmail.com"
                    value={accForm.imapHost}
                    onChange={(e) => setAccForm({ ...accForm, imapHost: e.currentTarget.value })}
                  />
                  <NumberInput
                    label="IMAP Port (TLS)"
                    value={accForm.imapPort}
                    onChange={(v) => setAccForm({ ...accForm, imapPort: Number(v) || 993 })}
                  />
                  <TextInput
                    label="IMAP Felhasználónév"
                    description="Üresen a postafiók címe."
                    value={accForm.imapUsername}
                    onChange={(e) => setAccForm({ ...accForm, imapUsername: e.currentTarget.value })}
                  />
                  <PasswordInput
                    label="IMAP Jelszó / App Password"
                    value={accForm.imapPassword}
                    onChange={(e) => setAccForm({ ...accForm, imapPassword: e.currentTarget.value })}
                  />
                </SimpleGrid>
              )}
            </Stack>
          </Paper>

          {/* 2. rész: a tömeges küldő (main küldő) */}
          <Paper p="sm" withBorder>
            <Stack gap="xs">
              <Text fw={600} size="sm">
                2. Tömeges küldő <Text span size="xs" c="dimmed" fw={400}>— a reklámlevelek feladója</Text>
              </Text>
              <SegmentedControl
                fullWidth
                value={accForm.provider}
                onChange={(v) => setAccForm({ ...accForm, provider: v })}
                data={[
                  { value: "smtp", label: "Postafiók SMTP-je" },
                  { value: "ses", label: "Külön Amazon SES" },
                ]}
              />
              {accForm.provider === "smtp" ? (
                <Text size="xs" c="dimmed">
                  A tömeges levelek is a postafiókról mennek
                  {accForm.mailboxEmail ? `: ${accForm.mailboxEmail}` : ""} — egyszerű, kis
                  volumenhez ideális.
                </Text>
              ) : (
                <>
                  <Text size="xs" c="dimmed">
                    Burner domain SES-sel (pl. okosurlap@quan.hu) — ha a Google letiltja,
                    csak ez bánja, a postafiók nem. A válaszok továbbra is a fenti
                    postafiókba érkeznek.
                  </Text>
                  <SimpleGrid cols={3}>
                    <TextInput
                      label="SES feladó e-mail (From)"
                      placeholder="okosurlap@quan.hu"
                      required
                      value={accForm.fromEmail}
                      onChange={(e) => setAccForm({ ...accForm, fromEmail: e.currentTarget.value })}
                    />
                    <Select
                      label="AWS Régió"
                      value={accForm.sesRegion}
                      onChange={(v) => setAccForm({ ...accForm, sesRegion: v || "eu-central-1" })}
                      data={[
                        { value: "eu-central-1", label: "eu-central-1 (Frankfurt)" },
                        { value: "eu-west-1", label: "eu-west-1 (Írország)" },
                        { value: "us-east-1", label: "us-east-1 (N. Virginia)" },
                        { value: "us-west-2", label: "us-west-2 (Oregon)" },
                      ]}
                    />
                    <NumberInput
                      label="Napi küldési limit"
                      min={1}
                      max={10000}
                      value={accForm.dailyLimit}
                      onChange={(v) => setAccForm({ ...accForm, dailyLimit: Number(v) || 50 })}
                    />
                  </SimpleGrid>
                  <SimpleGrid cols={2}>
                    <TextInput
                      label="AWS Access Key ID"
                      value={accForm.sesAccessKey}
                      onChange={(e) => setAccForm({ ...accForm, sesAccessKey: e.currentTarget.value })}
                    />
                    <PasswordInput
                      label="AWS Secret Access Key"
                      value={accForm.sesSecretKey}
                      onChange={(e) => setAccForm({ ...accForm, sesSecretKey: e.currentTarget.value })}
                    />
                  </SimpleGrid>
                </>
              )}
            </Stack>
          </Paper>

          <Switch
            label="Alapértelmezett küldő fiók"
            checked={accForm.isDefault}
            onChange={(e) => setAccForm({ ...accForm, isDefault: e.currentTarget.checked })}
          />

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setAccModalOpen(false)}>
              Mégse
            </Button>
            <Button onClick={handleSaveAccount}>Fiók mentése</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
