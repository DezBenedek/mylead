import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import {
  IconCheck,
  IconCommand,
  IconFileSpreadsheet,
  IconPaperclip,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { api } from "../lib/api";
import type {
  AppSettings,
  AssistantActionLog,
  AssistantChatMessage,
  NavSection,
} from "../types";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantActionLog[];
  aiError?: string | null;
  durationSec?: number;
}

interface AttachedCsv {
  fileName: string;
  content: string;
  rowCount: number;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  activeSearchId: string | null;
  settings: AppSettings;
  onAfterAction: (opts: {
    navigateTo?: NavSection | null;
    openSearchId?: string | null;
    dataChanged: boolean;
  }) => Promise<void>;
}

export function AssistantDrawer({
  opened,
  onClose,
  activeSearchId,
  settings,
  onAfterAction,
}: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Szia! Teljes hozzáférésem van a munkaterülethez: tudok leadeket törölni/szűrni/státuszt váltani, manuálisan kampányba venni, üzenetet küldeni vagy időzíteni, időzített auto-válaszokat megállítani vagy átírni, kereséseket futtatni és CSV-t kiértékelni. Írd le mit csináljak meg!",
    },
  ]);
  const [input, setInput] = useState("");
  const [attachedCsv, setAttachedCsv] = useState<AttachedCsv | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const activeRequestIdRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Amint megnyílik az asszisztens, a kurzor egyből a prompt mezőben legyen.
  useEffect(() => {
    if (!opened) return;
    const t = window.setTimeout(() => textareaRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [opened]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy, liveStatus]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    api
      .onAssistantStatus((ev) => {
        setLiveStatus(ev.message);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const readCsvFile = async (file: File) => {
    const content = await file.text();
    const lines = content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    setAttachedCsv({
      fileName: file.name,
      content,
      rowCount: Math.max(0, lines.length),
    });
  };

  const cancelCurrentRequest = () => {
    activeRequestIdRef.current += 1;
    setBusy(false);
    setLiveStatus("");
    setTurns((prev) => [
      ...prev,
      {
        id: `cancel-${Date.now()}`,
        role: "assistant",
        content: "Kérés megszakítva.",
        aiError:
          "Megszakítottad a várakozást. Ha az AI modell túl lassú vagy nem válaszol, válts másik modellre a Beállítások → AI fülön.",
      },
    ]);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !attachedCsv) || busy) return;

    const reqId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = reqId;
    const startTs = Date.now();

    // CSV upload + automatic evaluation pipeline!
    if (attachedCsv) {
      const csv = attachedCsv;
      const userLabel = text
        ? `📄 ${csv.fileName} (${csv.rowCount} sor)\n${text}`
        : `📄 ${csv.fileName} (${csv.rowCount} sor) — töltsd be és nézd át, jók-e a leadek`;

      setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: userLabel }]);
      setAttachedCsv(null);
      setInput("");
      setBusy(true);
      setLiveStatus(`CSV feldolgozása: ${csv.fileName}...`);

      try {
        const res = await api.importCsvAndEvaluate(csv.fileName, csv.content, text, null);
        if (activeRequestIdRef.current !== reqId) return;
        const dur = Math.max(1, Math.round((Date.now() - startTs) / 1000));

        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: `Betöltöttem ${res.importedCount} céget a „${csv.fileName}” fájlból (${res.skippedCount} üres/hibás sor kihagyva), és azonnal elindítottam az 5-ös párhuzamos weboldal-auditot és alkalmassági kiértékelést! Megnyitom az élő nézetet, ahol követheted, kik a jó fitek.`,
            actions: [
              {
                tool: "import_csv",
                summary: `${res.importedCount} cég mentve a központi adatbázisba (${res.searchName})`,
                ok: true,
              },
              {
                tool: "evaluate_batch_5",
                summary: "5-ös párhuzamos weboldal-audit & mély kutatás elindítva",
                ok: true,
              },
            ],
            durationSec: dur,
          },
        ]);

        await onAfterAction({
          navigateTo: "searches",
          openSearchId: res.searchId,
          dataChanged: true,
        });
      } catch (err) {
        if (activeRequestIdRef.current !== reqId) return;
        setTurns((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            content: "Nem sikerült feldolgozni a CSV fájlt.",
            aiError: String(err),
          },
        ]);
      } finally {
        if (activeRequestIdRef.current === reqId) {
          setBusy(false);
          setLiveStatus("");
        }
      }
      return;
    }

    // Standard Assistant Command
    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);
    setLiveStatus("Kérés küldése...");

    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const watchdogPromise = new Promise<never>((_, reject) => {
      watchdogTimer = setTimeout(() => {
        reject(
          new Error(
            `Az AI modell (${settings.aiProvider} / ${settings.aiModel || "alapértelmezett"}) 65 másodpercen belül nem adott választ. Ellenőrizd a modellt vagy válassz másikat a Beállításokban!`
          )
        );
      }, 65000);
    });

    try {
      const history: AssistantChatMessage[] = nextTurns
        .filter((t) => t.id !== "welcome")
        .map((t) => ({ role: t.role, content: t.content }));

      const res = await Promise.race([
        api.runAssistantCommand(text, history, activeSearchId),
        watchdogPromise,
      ]);

      if (activeRequestIdRef.current !== reqId) return;
      const dur = Math.max(1, Math.round((Date.now() - startTs) / 1000));

      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: res.reply || "A kért művelet lefutott.",
          actions: res.actions,
          aiError: res.aiError,
          durationSec: dur,
        },
      ]);

      await onAfterAction({
        navigateTo: (res.navigateTo as NavSection | null) || null,
        openSearchId: res.openSearchId,
        dataChanged: res.dataChanged,
      });
    } catch (err) {
      if (activeRequestIdRef.current !== reqId) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      setTurns((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: "Az AI modell nem adott választ.",
          aiError: errMsg,
        },
      ]);
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (activeRequestIdRef.current === reqId) {
        setBusy(false);
        setLiveStatus("");
      }
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      padding={0}
      withCloseButton={false}
      styles={{
        body: { height: "100%", display: "flex", flexDirection: "column" },
      }}
    >
      {/* Hidden native CSV file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.tsv,text/csv,text/plain"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readCsvFile(f);
          e.target.value = "";
        }}
      />

      {/* Crisp Header */}
      <Group
        justify="space-between"
        px="md"
        py={12}
        style={{
          borderBottom: "1px solid var(--ml-border)",
          backgroundColor: "var(--ml-surface)",
        }}
      >
        <Group gap={8}>
          <IconCommand size={16} />
          <Box>
            <Group gap={6}>
              <Text size="sm" fw={700} lh={1.2}>
                Központi Asszisztens
              </Text>
              <Badge size="xs" variant="default">
                {settings.aiProvider}
              </Badge>
            </Group>
            <Text size="11px" c="dimmed" lh={1.2}>
              {settings.aiModel || "alapértelmezett modell"} • ⌘K
            </Text>
          </Box>
        </Group>
        <Group gap={4}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            title="Beszélgetés törlése"
            onClick={() =>
              setTurns([
                {
                  id: "welcome",
                  role: "assistant",
                  content: "Tiszta lap. Írd le mit csináljak, vagy húzz ide egy CSV-t!",
                },
              ])
            }
          >
            <IconTrash size={14} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose}>
            <IconX size={15} />
          </ActionIcon>
        </Group>
      </Group>

      {/* Messages Scroll Area (with CSV Drag & Drop support!) */}
      <ScrollArea
        style={{
          flex: 1,
          backgroundColor: isDragging ? "rgba(22, 101, 52, 0.06)" : "var(--ml-canvas)",
          outline: isDragging ? "2px dashed #166534" : "none",
          outlineOffset: -6,
        }}
        p="md"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) readCsvFile(f);
        }}
      >
        <Stack gap="sm">
          {turns.map((turn) => {
            const isUser = turn.role === "user";
            return (
              <Box
                key={turn.id}
                style={{
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  maxWidth: "94%",
                }}
              >
                <Paper
                  p="sm"
                  style={{
                    backgroundColor: isUser ? "#166534" : "var(--ml-surface)",
                    color: isUser ? "#faf9f7" : "var(--ml-ink)",
                    borderColor: isUser ? "#166534" : "var(--ml-border)",
                  }}
                >
                  {turn.aiError && (
                    <Box
                      mb="xs"
                      p="xs"
                      style={{
                        borderRadius: 4,
                        border: "1px solid #fca5a5",
                        backgroundColor: "rgba(220, 38, 38, 0.08)",
                      }}
                    >
                      <Text size="11px" fw={700} c="red.7">
                        AI modell hiba / nincs válasz:
                      </Text>
                      <Text size="11px" c="red.8" mt={2} style={{ whiteSpace: "pre-wrap" }}>
                        {turn.aiError}
                      </Text>
                    </Box>
                  )}

                  <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                    {turn.content}
                  </Text>

                  {turn.actions && turn.actions.length > 0 && (
                    <Stack
                      gap={5}
                      mt="xs"
                      pt="xs"
                      style={{ borderTop: "1px solid var(--ml-border)" }}
                    >
                      <Text className="ml-section-label">Végrehajtott műveletek</Text>
                      {turn.actions.map((a, idx) => (
                        <Group key={idx} gap={6} wrap="nowrap" align="flex-start">
                          <Badge
                            size="xs"
                            color={a.ok ? "green" : "red"}
                            leftSection={a.ok ? <IconCheck size={10} /> : <IconX size={10} />}
                          >
                            {a.tool}
                          </Badge>
                          <Text size="11px" c="dimmed">
                            {a.summary}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  )}

                  {!isUser && turn.durationSec && (
                    <Text size="10px" c="dimmed" ta="right" mt={4} className="ml-tabular">
                      {turn.durationSec} mp
                    </Text>
                  )}
                </Paper>
              </Box>
            );
          })}

          {busy && (
            <Paper p="sm" style={{ alignSelf: "flex-start", width: "92%" }}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Loader size={14} color="forest" />
                  <Text size="xs" fw={500} truncate>
                    {liveStatus || "Feldolgozás..."}
                  </Text>
                </Group>
                <Group gap={6} wrap="nowrap">
                  <Text size="11px" c="dimmed" className="ml-tabular">
                    {elapsedSec}s
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={cancelCurrentRequest}
                  >
                    Megszakítás
                  </Button>
                </Group>
              </Group>
            </Paper>
          )}
          <div ref={bottomRef} />
        </Stack>
      </ScrollArea>

      {/* Clean Composer + CSV Upload Bar (no clutter quick prompts!) */}
      <Box
        p="sm"
        style={{
          borderTop: "1px solid var(--ml-border)",
          backgroundColor: "var(--ml-surface)",
        }}
      >
        {attachedCsv && (
          <Paper
            p="xs"
            mb="xs"
            style={{
              backgroundColor: "var(--ml-canvas)",
              borderColor: "#166534",
            }}
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                <IconFileSpreadsheet size={16} color="#166534" />
                <Box style={{ minWidth: 0 }}>
                  <Text size="xs" fw={600} truncate>
                    {attachedCsv.fileName}
                  </Text>
                  <Text size="11px" c="dimmed">
                    {attachedCsv.rowCount} sor • Kattints a Küldésre az azonnali betöltéshez és
                    kiértékeléshez
                  </Text>
                </Box>
              </Group>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setAttachedCsv(null)}
              >
                <IconX size={13} />
              </ActionIcon>
            </Group>
          </Paper>
        )}

        {/* Egyetlen lekerekített prompt mező: bal oldalt a csatolás, jobb oldalt a küldés. */}
        <Box className="ml-assistant-composer">
          <ActionIcon
            size="md"
            radius="xl"
            variant="subtle"
            color="gray"
            title="CSV feltöltése (leadek betöltése és azonnali átnézése)"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            style={{ flexShrink: 0, marginBottom: 2 }}
          >
            <IconPaperclip size={18} />
          </ActionIcon>
          <Textarea
            ref={textareaRef}
            variant="unstyled"
            autoFocus
            placeholder={
              attachedCsv
                ? "Opcionális szempont a CSV kiértékeléshez (pl. nézd meg, van-e online foglalójuk)..."
                : "Írj parancsot vagy tölts fel CSV-t..."
            }
            minRows={1}
            maxRows={5}
            autosize
            style={{ flex: 1, minWidth: 0 }}
            styles={{ input: { padding: "8px 4px", fontSize: 13, lineHeight: 1.5 } }}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <ActionIcon
            size="md"
            radius="xl"
            variant="filled"
            color="forest"
            title={attachedCsv ? "Kiértékelés" : "Küldés"}
            aria-label={attachedCsv ? "Kiértékelés" : "Küldés"}
            loading={busy}
            disabled={!input.trim() && !attachedCsv}
            onClick={() => sendMessage()}
            style={{ flexShrink: 0, marginBottom: 2 }}
          >
            <IconSend size={16} />
          </ActionIcon>
        </Box>
      </Box>
    </Drawer>
  );
}
