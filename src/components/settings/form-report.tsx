"use client";

import { createContext, useContext, useEffect } from "react";
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
