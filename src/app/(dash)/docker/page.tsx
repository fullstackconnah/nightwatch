"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Answer } from "@/components/docker/answer";
import { Chores } from "@/components/docker/chores";
import { Everything } from "@/components/docker/everything";
import type { VolumeItem } from "@/components/docker/rows";
import { useDiskReclaim } from "@/components/resources/reclaim-shared";
import { CreateContainerDialog } from "@/components/resources/create-container";
import { fetcher, useContainers } from "@/lib/client";
import { findKind, heroBytes, slotItem, unusedTaggedBytes, type ImageItem, type FindKind } from "@/lib/docker-chores";
import { relativeTime } from "@/lib/format";

const SWR_SLOW = { refreshInterval: 30000, keepPreviousData: true };

function DockerPage() {
  const find = useSearchParams().get("find");
  const [kind, setKind] = useState<FindKind>(findKind(find));
  const [showCreate, setShowCreate] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const everythingRef = useRef<HTMLElement>(null);
  const lastOk = useRef<number | null>(null);
  const scrolled = useRef(false);

  const ctr = useContainers(5000);
  const img = useSWR<{ images: ImageItem[] }>("/api/docker/images", fetcher, SWR_SLOW);
  const vol = useSWR<{ volumes: VolumeItem[] }>("/api/docker/volumes", fetcher, SWR_SLOW);
  const disk = useDiskReclaim(30000);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (ctr.data && !ctr.error && !ctr.isValidating) lastOk.current = Date.now();
  }, [ctr.data, ctr.error, ctr.isValidating]);

  const containers = ctr.data?.containers ?? [];
  const images = img.data?.images ?? [];
  const volumes = vol.data?.volumes ?? [];
  const reclaim = disk.data ?? null;
  const errors = { containers: ctr.error?.message ?? null, images: img.error?.message ?? null, volumes: vol.error?.message ?? null };
  const down = !!(errors.containers && errors.images && errors.volumes);
  const orphans = reclaim?.volumes.orphans ?? [];
  const sizesPending = orphans.some((o) => o.size == null);
  const loading = !reclaim && !disk.error;
  const hero = reclaim ? heroBytes(reclaim, sizesPending) : { bytes: 0, plus: false };

  const slot = loading
    ? null
    : slotItem({
        containers: { error: errors.containers, loaded: !!ctr.data },
        images: { error: errors.images, loaded: !!img.data },
        volumes: { error: errors.volumes, loaded: !!vol.data },
        disk: { error: disk.error?.message ?? null, loaded: !!reclaim },
        sizesPending,
        buildCacheBytes: reclaim?.buildCacheBytes ?? null,
        staleMs: lastOk.current == null ? null : now - lastOk.current,
        agoText: lastOk.current == null ? "earlier" : relativeTime(lastOk.current),
      });

  // ?find= picks the segment and scrolls Everything into view once, instantly, after the first data paint.
  useEffect(() => {
    if (find && !scrolled.current && ctr.data) {
      scrolled.current = true;
      everythingRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [find, ctr.data]);

  const refresh = () => Promise.all([ctr.mutate(), img.mutate(), vol.mutate(), disk.mutate()]);

  return (
    <div className="dk-page">
      <header className="dk-head">
        <div>
          <h1>Docker</h1>
          <p className="dk-counts">
            {ctr.data ? `${containers.length} containers · ${images.length} images · ${volumes.length} volumes` : ctr.error ? "Docker unreachable" : "Reading Docker…"}
          </p>
        </div>
        <Button data-feature="create" disabled={down} onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New container
        </Button>
      </header>

      <Answer
        loading={loading}
        diskError={!!disk.error && !reclaim}
        bytes={hero.bytes}
        plus={hero.plus}
        sizesPending={sizesPending}
        segments={{
          dangling: reclaim?.images.danglingBytes ?? 0,
          orphans: sizesPending ? 0 : (reclaim?.volumes.orphanBytes ?? 0),
          unused: unusedTaggedBytes(images),
          cache: reclaim?.buildCacheBytes ?? null,
        }}
        slot={slot}
      />

      <section className="dk-chores" aria-labelledby="dk-chores-h">
        <div className="dk-section-head">
          <h2 id="dk-chores-h">To clear, biggest first</h2>
        </div>
        <Chores
          input={reclaim ? { reclaim, images, containers, volumes } : null}
          containers={containers}
          images={images}
          sizesPending={sizesPending}
          errors={errors}
          down={down}
          refresh={refresh}
        />
      </section>

      <Everything
        ref={everythingRef}
        kind={kind}
        onKind={setKind}
        containers={containers}
        images={images}
        volumes={volumes}
        errors={errors}
        refresh={refresh}
      />

      {showCreate && (
        <CreateContainerDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DockerPage />
    </Suspense>
  );
}
