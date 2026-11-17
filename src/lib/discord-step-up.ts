/* Alias-free so node:test can load it: the one rule for when a Hermes daemon save changes Discord access and asks for the current password. The route and the card both call it. */

export interface DiscordStepUpChange {
  botToken?: string;
  clearBotToken?: boolean;
  webhookUrl?: string;
  clearWebhookUrl?: boolean;
  /** Already split and trimmed (see splitUserIds); undefined means the save leaves the list alone. */
  allowedUserIds?: string[];
  /** Trimmed; undefined means the save leaves the channel alone. */
  channelId?: string;
}

/** The comma split the card sends and the card's pending check reads, so the two cannot differ. */
export function splitUserIds(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * Whether the card shows the password field. A pending Discord change always does; a refusal keeps it only while the
 * drafts are the ones refused (the server can refuse when the card sees nothing pending, e.g. the file changed in
 * another tab), so reverting the edits after a refusal drops the field and its disabled Save.
 */
export function stepUpAsked(pending: boolean, askedAt: string | null, draftKey: string): boolean {
  return pending || (askedAt !== null && askedAt === draftKey);
}

/** A secret counts when it is typed (trimmed, non-empty) or cleared; the server never compares secrets. */
export function discordStepUpNeeded(
  change: DiscordStepUpChange,
  existing: { discordAllowedUserIds?: string[]; discordChannelId?: string },
): boolean {
  return (
    change.clearBotToken === true ||
    change.clearWebhookUrl === true ||
    Boolean(change.botToken?.trim()) ||
    Boolean(change.webhookUrl?.trim()) ||
    (change.allowedUserIds !== undefined &&
      change.allowedUserIds.map((x) => x.trim()).filter(Boolean).join("\n") !== (existing.discordAllowedUserIds ?? []).join("\n")) ||
    (change.channelId !== undefined && change.channelId.trim() !== (existing.discordChannelId ?? ""))
  );
}
