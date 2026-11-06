"use client";

/* THESIS: the strips pattern on /git. A pure gitModel() answers "is my code safely mirrored to GitHub, and what is
   moving" and picks the strip the answer names; four fixed strips (Mirrors, Pull requests, Branches, Commits) hold what
   used to be a stack of panels. Sync now is the one write and sits per mirror. OWN-WORLD: nightwatch console — the
   pattern's .st-* classes, house Badge and Button, no new token. */

import { useEffect, useState } from "react";
import { BranchRows, PullRows } from "@/components/integrations/git-branches-panel";
import { GitCommitStream } from "@/components/integrations/git-commit-stream";
import { MirrorRows } from "@/components/integrations/git-mirror-panel";
import { PageHead } from "@/components/strips/page-head";
import { StripList, type StripSpec } from "@/components/strips/strip-list";
import { buttonVariants } from "@/components/ui/button";
import { gitModel, type StripId } from "@/lib/git/page-model";
import { useGit } from "@/lib/use-forgejo";
import { useNow } from "@/lib/use-now";

export default function GitPage() {
  const { data, error, isValidating } = useGit();
  const now = useNow(true);

  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  useEffect(() => {
    if (!isValidating && !error && data) setLastOkAt(Date.now());
  }, [isValidating, error, data]);

  const model = gitModel({ data, loadError: Boolean(error), lastOkAt, now });
  const ok = data?.status === "ok" ? data : undefined;

  // No lead paragraph: the head answer says it once and the mirror rows hold each failure in full.
  const parts: Record<StripId, Pick<StripSpec, "body">> | undefined = ok && {
    mirrors: { body: <MirrorRows mirrors={ok.mirrors} enabled={model.writes[0].enabled} forgejoUrl={ok.forgejoUrl} /> },
    pulls: { body: <PullRows pulls={ok.pulls} /> },
    branches: { body: <BranchRows branches={ok.branches} /> },
    commits: { body: <GitCommitStream stream={ok.stream} /> },
  };
  const strips: StripSpec[] = parts ? model.strips.map((s) => ({ ...s, ...parts[s.id] })) : [];

  // The Forgejo link opens in a new tab, as the old empty-state link did; PageHead's own link is same-tab.
  const action = model.link && (
    <a href={model.link.href} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
      {model.link.label}
    </a>
  );

  return (
    <div className="st-page pb-2">
      <PageHead
        title="Git"
        chip={model.chip}
        answer={model.answer}
        evidence={model.evidence}
        link={model.link}
        action={model.link && !model.link.href.startsWith("/") ? action : undefined}
        notice={model.notice}
      />
      {strips.length > 0 && <StripList strips={strips} autoTarget={model.autoTarget} />}
    </div>
  );
}
