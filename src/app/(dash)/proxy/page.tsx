"use client";

/* THESIS: the strips pattern on /proxy. A pure proxyModel() answers "is any route down, or a certificate about to
   expire" and picks the strip the answer names; two fixed strips (Routes, Certificates) hold the route map and the
   certificate list. Read-only by design: NPM's own admin does the editing, so the page's one action is the link out.
   OWN-WORLD: nightwatch console — the pattern's .st-* classes, house Badge and Button, no new token. */

import { useEffect, useState, type ReactNode } from "react";
import { CertificatesPanel } from "@/components/integrations/proxy-certificates";
import { RouteTable } from "@/components/integrations/proxy-routes";
import { PageHead } from "@/components/strips/page-head";
import { StripList, type StripSpec } from "@/components/strips/strip-list";
import { buttonVariants } from "@/components/ui/button";
import { proxyModel, type StripId } from "@/lib/proxy/page-model";
import { useProxyManager } from "@/lib/use-npm";
import { useNow } from "@/lib/use-now";

export default function ProxyPage() {
  const { data, error, isValidating } = useProxyManager();
  const now = useNow(true);

  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  useEffect(() => {
    if (!isValidating && !error && data) setLastOkAt(Date.now());
  }, [isValidating, error, data]);

  const model = proxyModel({ data, loadError: Boolean(error), lastOkAt, now });
  const ok = data?.status === "ok" ? data : undefined;

  const lead = (id: StripId, body: ReactNode) => (
    <>
      {model.autoTarget === id && model.detailLead && <p className="st-note mb-3">{model.detailLead}</p>}
      {body}
    </>
  );

  const parts: Record<StripId, Pick<StripSpec, "body">> | undefined = ok && {
    routes: { body: lead("routes", <RouteTable routes={ok.routes} />) },
    certs: { body: lead("certs", <CertificatesPanel certificates={ok.certificates} />) },
  };
  const strips: StripSpec[] = parts ? model.strips.map((s) => ({ ...s, ...parts[s.id] })) : [];

  // The NPM admin link opens in a new tab, as before; PageHead's own link is same-tab (right for Settings).
  const external = model.link && !model.link.href.startsWith("/");
  const action = external && (
    <a href={model.link!.href} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
      {model.link!.label}
    </a>
  );

  return (
    <div className="st-page pb-2">
      <PageHead
        title="Proxy"
        chip={model.chip}
        answer={model.answer}
        evidence={model.evidence}
        link={model.link}
        action={action || undefined}
        notice={model.notice}
      />
      {strips.length > 0 && <StripList strips={strips} autoTarget={model.autoTarget} />}
    </div>
  );
}
