// Cliente minimo de Telegram Bot API. No usa libs: solo fetch nativo de Node 20.
// Falla en silencio si no esta configurado (no rompe el servicio).

const API_BASE = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_CHAT_ID);
}

interface NotifyOptions {
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableNotification?: boolean;
}

/** Devuelve message_id si fue enviado, null si no esta configurado o si fallo. */
export async function notifyOwner(
  text: string,
  opts: NotifyOptions = {}
): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return null;

  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts.parseMode ?? "Markdown",
        disable_notification: opts.disableNotification ?? false,
      }),
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      console.error("[telegram] sendMessage fallo", res.status, data);
      return null;
    }
    if (
      data &&
      typeof data === "object" &&
      "result" in data &&
      typeof (data as { result: unknown }).result === "object"
    ) {
      const result = (data as { result: { message_id?: number } }).result;
      return result?.message_id ?? null;
    }
    return null;
  } catch (err) {
    console.error("[telegram] sendMessage threw", err);
    return null;
  }
}

export async function editOwnerMessage(
  messageId: number,
  newText: string,
  opts: NotifyOptions = {}
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${API_BASE}/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: opts.parseMode ?? "Markdown",
      }),
    });
    if (!res.ok) {
      const data = await res.text();
      console.error("[telegram] editMessageText fallo", res.status, data);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] editMessageText threw", err);
    return false;
  }
}
