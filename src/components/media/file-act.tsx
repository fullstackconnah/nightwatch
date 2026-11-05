"use client";

import { WriteAction } from "@/components/strips/write-action";
import { Button } from "@/components/ui/button";
import { ApiError, postJson } from "@/lib/client";
import type { QueueView, RowAct } from "@/lib/media/page-model";

/** The route's own sentences (or the worker's plain reason), lower-cased to follow "Couldn’t compress X:". */
const reasonOf = (e: unknown) => {
  const s = e instanceof ApiError ? e.message : "The media worker didn’t answer.";
  return s.charAt(0).toLowerCase() + s.slice(1);
};
/** A 44 px target on touch, the compact size from md up (as settings-widgets does). */
const TAP = "min-h-11 min-w-11 md:min-h-0 md:min-w-0";
async function post(url: string, body?: unknown) {
  try {
    await postJson(url, body);
  } catch (e) {
    throw new Error(reasonOf(e));
  }
}

/** One file's write, from the page model's `act`: Compress, Try again, Cancel, Undo. Off while the page shows old data. */
export function FileAct({ act, off, onChanged, onDismiss }: { act: RowAct; off: boolean; onChanged: () => void; onDismiss?: () => void }) {
  const done = async (p: Promise<void>) => {
    await p;
    onChanged();
  };
  switch (act.kind) {
    case "compress":
    case "retry":
      return (
        <>
          <WriteAction
            label={act.kind === "retry" ? "Try again" : "Compress"}
            ariaLabel={act.kind === "retry" ? `Try compressing ${act.name} again` : `Compress ${act.name}`}
            say={act.say}
            yes="Yes, compress"
            flight="Adding to the queue…"
            failure={`Couldn’t compress ${act.name}`}
            disabled={off}
            triggerClassName={TAP}
            run={() => done(post("/api/media/jobs", { path: act.path }))}
          />
          {act.kind === "retry" && onDismiss && (
            <Button size="sm" variant="ghost" className={TAP} onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </>
      );
    case "cancel":
      return (
        <WriteAction
          label="Cancel"
          ariaLabel={act.confirm ? `Stop compressing ${act.name}` : `Remove ${act.name} from the queue`}
          confirm={act.confirm}
          say={`Stops compressing ${act.name}. The original stays as it is.`}
          yes="Yes, stop"
          flight={act.confirm ? "Stopping…" : "Removing…"}
          failure={`Couldn’t stop ${act.name}`}
          disabled={off}
          triggerClassName={TAP}
          run={() => done(post(`/api/media/jobs/${act.id}/cancel`))}
        />
      );
    case "undo":
      return (
        <WriteAction
          label="Undo"
          ariaLabel={`Undo compressing ${act.name}`}
          say={`Puts the original ${act.name} back and deletes the compressed copy.`}
          yes="Yes, undo"
          flight="Restoring…"
          failure={`Couldn’t undo ${act.name}`}
          disabled={off}
          triggerClassName={TAP}
          run={() => done(post(`/api/media/jobs/${act.id}/undo`))}
        />
      );
  }
}

/** The queue strip's slot: stops every queued job first, then the running one, so nothing new starts in between. */
export function CancelAll({ say, ids, off, onChanged }: { say: string; ids: string[]; off: boolean; onChanged: () => void }) {
  return (
    <WriteAction
      label="Cancel all"
      say={say}
      yes="Yes, cancel all"
      flight="Cancelling…"
      failure="Couldn’t cancel the queue"
      disabled={off}
      triggerClassName={TAP}
      run={async () => {
        let first: unknown;
        for (const id of ids) {
          try {
            await postJson(`/api/media/jobs/${id}/cancel`);
          } catch (e) {
            first ??= e;
          }
        }
        onChanged();
        if (first) throw new Error(reasonOf(first));
      }}
    />
  );
}

/** The queue strip's detail: the running job with its bar, then what is waiting, then what finished. */
export function QueueBody({ queue, off, onChanged }: { queue: QueueView; off: boolean; onChanged: () => void }) {
  const act = (l: { id: string; name: string; cancel: "ask" | "now" | null }): RowAct | null =>
    l.cancel ? { kind: "cancel", id: l.id, name: l.name, confirm: l.cancel === "ask" } : null;
  const line = (l: QueueView["recent"][number], key: string) => {
    const a = act(l);
    return (
      <li key={key} className="st-li md-qrow" data-feature="queue-row">
        <span className="md-name" title={l.name}>
          {l.name}
        </span>
        <span className="md-word" data-kind={l.tone ?? undefined}>
          {l.word}
        </span>
        <span className="md-line">{l.line}</span>
        {a && <FileAct act={a} off={off} onChanged={onChanged} />}
      </li>
    );
  };
  const c = queue.current;
  return (
    <div className="st-stack">
      {c && (
        <div className="md-qrow" data-feature="queue-current">
          <span className="md-name" title={c.name}>
            {c.name}
          </span>
          {c.pct !== null && (
            <div className="md-bar" role="progressbar" aria-label={`Compressing ${c.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.pct)} style={{ flexBasis: "100%" }}>
              <span style={{ transform: `scaleX(${c.pct / 100})` }} />
            </div>
          )}
          <span className="md-line">{c.line}</span>
          {act(c) && <FileAct act={act(c) as RowAct} off={off} onChanged={onChanged} />}
        </div>
      )}
      {queue.queued.length > 0 && (
        <ul className="md-files" role="list" aria-label="Queued">
          {queue.queued.map((l) => line(l, l.id))}
        </ul>
      )}
      {queue.recent.length > 0 && (
        <section>
          <div className="st-listhead">
            <span>Recent</span>
          </div>
          <ul className="md-files" role="list" aria-label="Recent">
            {queue.recent.map((l) => line(l, l.id))}
          </ul>
        </section>
      )}
      {!c && queue.queued.length === 0 && queue.recent.length === 0 && <p className="st-note">Compress is off until calibration is done.</p>}
    </div>
  );
}
