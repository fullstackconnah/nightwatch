"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReclaimImagesPanel } from "@/components/reclaim-images";
import { ReclaimedBanner, type PruneResult } from "@/components/reclaim-shared";
import { ImageDeleteAction, type ImageDeleteResult } from "@/components/image-delete-action";
import {
  buildImageGroups,
  RegistryChip,
  UNTAGGED,
  type ImageGroup,
  type ImageRow,
} from "@/components/image-groups";
import { fetcher } from "@/lib/client";
import { formatBytes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A spacer roughly the width of the disclosure chevron + its gap, so a flat
 *  (single-tag) repo's ref text starts at the same x as an expandable one's. */
function ChevronSpacer() {
  return <span className="inline-block w-5 shrink-0" aria-hidden />;
}

function GroupRows({
  group,
  expanded,
  onToggle,
  onDeleted,
}: {
  group: ImageGroup;
  expanded: boolean;
  onToggle: () => void;
  onDeleted: (result: ImageDeleteResult) => void;
}) {
  const repoLabel = group.repo === UNTAGGED ? UNTAGGED : group.repo;

  // Single-tag repos never earn a disclosure — the group row IS the tag row.
  if (group.tags.length === 1) {
    const tag = group.tags[0];
    return (
      <tr className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
        <td className="px-3 py-2 max-w-56">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronSpacer />
            <span className="font-mono text-xs truncate min-w-0 flex-1" title={tag.ref}>
              {tag.ref}
            </span>
            {group.registry && <RegistryChip registry={group.registry} />}
          </div>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
          {formatBytes(tag.size, 0)}
        </td>
        <td className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
          {relativeTime(tag.created * 1000)}
        </td>
        <td className="px-3 py-2">{tag.inUse ? <Badge variant="ok">in use</Badge> : <Badge>unused</Badge>}</td>
        <td className="px-3 py-2 text-right">
          <ImageDeleteAction
            imageId={tag.imageId}
            label={tag.ref}
            size={tag.size}
            inUse={tag.inUse}
            usedBy={tag.usedBy}
            onDeleted={onDeleted}
          />
        </td>
      </tr>
    );
  }

  const usedCount = group.tags.filter((t) => t.inUse).length;

  return (
    <>
      <tr className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
        <td className="px-3 py-2 max-w-56">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${repoLabel}`}
            className="flex items-center gap-2 min-w-0 w-full text-left cursor-pointer"
          >
            <ChevronDown
              size={13}
              className={cn("text-ink-faint transition-transform shrink-0", expanded && "rotate-180")}
            />
            <span className="font-mono text-xs truncate min-w-0 flex-1" title={repoLabel}>
              {repoLabel}
            </span>
            {group.registry && <RegistryChip registry={group.registry} />}
            <span className="microlabel shrink-0">{group.tags.length} tags</span>
          </button>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
          {formatBytes(group.totalSize, 0)}
        </td>
        <td className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
          {relativeTime(group.latestCreated * 1000)}
        </td>
        <td className="px-3 py-2">
          {usedCount > 0 ? <Badge variant="ok">{usedCount} in use</Badge> : <Badge>unused</Badge>}
        </td>
        <td className="px-3 py-2" />
      </tr>
      {expanded &&
        group.tags.map((tag) => (
          <tr
            key={tag.imageId + tag.ref}
            className="border-b border-line/50 last:border-0 bg-panel-2/30 hover:bg-panel-2/60"
          >
            <td className="px-3 py-2 max-w-56">
              <div className="flex items-center gap-2 min-w-0 pl-[1.625rem]">
                <span className="font-mono text-xs text-ink-dim truncate min-w-0 flex-1" title={tag.ref}>
                  {tag.tag ?? tag.ref}
                </span>
              </div>
            </td>
            <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
              {formatBytes(tag.size, 0)}
            </td>
            <td className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
              {relativeTime(tag.created * 1000)}
            </td>
            <td className="px-3 py-2">
              {tag.inUse ? <Badge variant="ok">in use</Badge> : <Badge>unused</Badge>}
            </td>
            <td className="px-3 py-2 text-right">
              <ImageDeleteAction
                imageId={tag.imageId}
                label={tag.ref}
                size={tag.size}
                inUse={tag.inUse}
                usedBy={tag.usedBy}
                onDeleted={onDeleted}
              />
            </td>
          </tr>
        ))}
    </>
  );
}

function TagCardBody({ tag, onDeleted }: { tag: ImageGroup["tags"][number]; onDeleted: (r: ImageDeleteResult) => void }) {
  return (
    <div className="flex items-end justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-3">
        <div>
          <div className="microlabel">size</div>
          <div className="font-mono text-xs text-ink-dim">{formatBytes(tag.size, 0)}</div>
        </div>
        <div>
          <div className="microlabel">created</div>
          <div className="text-xs text-ink-faint whitespace-nowrap">{relativeTime(tag.created * 1000)}</div>
        </div>
        <div>
          <div className="microlabel">status</div>
          {tag.inUse ? <Badge variant="ok">in use</Badge> : <Badge>unused</Badge>}
        </div>
      </div>
      <ImageDeleteAction
        imageId={tag.imageId}
        label={tag.ref}
        size={tag.size}
        inUse={tag.inUse}
        usedBy={tag.usedBy}
        onDeleted={onDeleted}
      />
    </div>
  );
}

function GroupCard({
  group,
  expanded,
  onToggle,
  onDeleted,
}: {
  group: ImageGroup;
  expanded: boolean;
  onToggle: () => void;
  onDeleted: (result: ImageDeleteResult) => void;
}) {
  const repoLabel = group.repo === UNTAGGED ? UNTAGGED : group.repo;

  if (group.tags.length === 1) {
    const tag = group.tags[0];
    return (
      <div className="panel p-3 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs break-all flex-1 min-w-0">{tag.ref}</span>
          {group.registry && <RegistryChip registry={group.registry} />}
        </div>
        <TagCardBody tag={tag} onDeleted={onDeleted} />
      </div>
    );
  }

  const usedCount = group.tags.filter((t) => t.inUse).length;

  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${repoLabel}`}
        className="w-full flex items-center gap-2 px-3 min-h-11 text-left hover:bg-panel-2/60 cursor-pointer"
      >
        <ChevronDown
          size={14}
          className={cn("text-ink-faint transition-transform shrink-0", expanded && "rotate-180")}
        />
        <span className="font-mono text-xs truncate flex-1 min-w-0" title={repoLabel}>
          {repoLabel}
        </span>
        {group.registry && <RegistryChip registry={group.registry} />}
        <span className="microlabel shrink-0">{group.tags.length} tags</span>
      </button>
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 border-b border-line flex-wrap">
        <span className="font-mono text-xs text-ink-dim">{formatBytes(group.totalSize, 0)}</span>
        <span className="text-[0.7rem] text-ink-faint whitespace-nowrap">
          {relativeTime(group.latestCreated * 1000)}
        </span>
        {usedCount > 0 ? <Badge variant="ok">{usedCount} in use</Badge> : <Badge>unused</Badge>}
      </div>
      {expanded && (
        <div className="divide-y divide-line/50">
          {group.tags.map((tag) => (
            <div key={tag.imageId + tag.ref} className="p-3 space-y-2 bg-panel-2/30">
              <div className="font-mono text-xs text-ink-dim break-all">{tag.tag ?? tag.ref}</div>
              <TagCardBody tag={tag} onDeleted={onDeleted} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImagesPage() {
  const { data, error, mutate } = useSWR<{ images: ImageRow[] }>("/api/docker/images", fetcher, {
    refreshInterval: 30000,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastDeleted, setLastDeleted] = useState<PruneResult | null>(null);

  const groups = useMemo(() => buildImageGroups(data?.images ?? []), [data]);
  const total = (data?.images ?? []).reduce((a, i) => a + i.size, 0);
  const dangling = (data?.images ?? []).filter((i) => !i.inUse);

  function toggle(repo: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  }

  // Deleting an image changes both this page's own list and the Reclaimable
  // panel's "unused" total — mutate() refetches this page's key, and nudging
  // the reclaim panel's key through SWR's global cache refreshes it too,
  // without this page needing to reach into reclaim-images.tsx's own state.
  function handleDeleted(result: ImageDeleteResult) {
    setLastDeleted({
      reclaimedBytes: result.freedBytes,
      deleted: result.deleted.length > 0 ? result.deleted : [result.label],
    });
    void mutate();
    void globalMutate("/api/docker/disk-usage");
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Images</h1>
        <p className="text-xs text-ink-dim mt-0.5">
          {data
            ? `${data.images.length} images · ${formatBytes(total, 1)} total · ${dangling.length} unused`
            : "…"}
        </p>
      </header>

      {error && <div className="panel p-4 text-bad text-sm">{error.message}</div>}
      {!data && !error && <div className="panel p-4 text-sm text-ink-dim">Reading images…</div>}

      <ReclaimImagesPanel />

      {lastDeleted && <ReclaimedBanner result={lastDeleted} onDismiss={() => setLastDeleted(null)} />}

      {data && data.images.length === 0 && (
        <div className="panel p-4 text-sm text-ink-dim">No images on this host.</div>
      )}

      {groups.length > 0 && (
        <>
          <div className="panel overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["Image", "Size", "Created", "Status", ""].map((h) => (
                    <th key={h || "actions"} className="microlabel text-left px-3 py-2 font-semibold">
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows
                    key={g.repo}
                    group={g}
                    expanded={expanded.has(g.repo)}
                    onToggle={() => toggle(g.repo)}
                    onDeleted={handleDeleted}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {groups.map((g) => (
              <GroupCard
                key={g.repo}
                group={g}
                expanded={expanded.has(g.repo)}
                onToggle={() => toggle(g.repo)}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
