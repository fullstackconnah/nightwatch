"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { FormId, FormState } from "@/lib/settings/page-model";

type Report = (id: FormId, state: FormState) => void;
const FormReportContext = createContext<Report | null>(null);
export const FormReportProvider = FormReportContext.Provider;

/**
 * A form tells the page whether it holds an unsaved draft and what its last save said (D5), so the head can name it.
 * Outside a provider it does nothing. shortcut: a form that unmounts leaves its last report until it mounts again;
 * StripList keeps every body mounted, so only a width change remounts, and the new mount reports at once.
 */
export function useFormReport(id: FormId, { dirty, error }: FormState) {
  const report = useContext(FormReportContext);
  useEffect(() => report?.(id, { dirty, error }), [report, id, dirty, error]);
}

/**
 * The "saved" badge: lit for 2 s after each save. A repeat save drops the flag first so the sr-only status text
 * empties and refills (announced again), and the earlier timer is cleared so it cannot cut the new badge short.
 */
export function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    clearTimeout(timer.current);
    setSaved(false);
    timer.current = setTimeout(() => {
      setSaved(true);
      timer.current = setTimeout(() => setSaved(false), 2000);
    }, 0);
  }, []);
  return [saved, flash];
}
