// The detection settings pane: the phone's route matching switch, its two
// grouping numbers and its five section parameters. Each control asks its
// write and reads `detection.settings` again, so the pane shows what the
// phone holds; a refusal shows the engine's own message.

import { Checkbox, TextField } from "./ui";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";

import {
  DETECTION_FIELDS,
  detectionWrite,
  enabledWrite,
} from "./detectionSettings";
import type { DetectionSettings } from "./detectionSettings";
import { ReadNotice } from "./shell/StatePanes";
import { useRead } from "./useRead";
import { useSavedWrite } from "./useSavedWrite";

type Notice = { key: ParseKeys } | null;

export function DetectionPane() {
  const { t } = useTranslation();
  const read = useRead("detection.settings", {} as never);
  const { save, refusal, clearRefusal } = useSavedWrite(["detection.settings"]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const held = read.data as DetectionSettings | undefined;

  const send = useCallback(
    async (
      change: { method: string; params: object },
      previous?: { method: string; params: object },
    ) => {
      // The write reads the settings again, so the pane shows what the phone holds.
      const taken = await save(change, {
        ...(previous ? { previous } : {}),
        optimistic:
          change.method === "detection.setEnabled"
            ? [
                {
                  method: "detection.settings",
                  args: {},
                  update: (
                    current: DetectionSettings,
                    params: { enabled: boolean },
                  ) => ({
                    ...current,
                    enabled: params.enabled,
                  }),
                },
              ]
            : [],
      });
      if (taken) {
        setNotice(null);
        setDrafts({});
      }
    },
    [save],
  );

  if (read.error && !held)
    return <ReadNotice error={read.error} onRetry={read.retry} />;
  if (!held)
    return <p id="detection-loading">{t("connectPage.settings.notSet")}</p>;

  return (
    <div id="detection-pane">
      <label className="settings-row">
        <span className="settings-label">{t("settings.routeMatching")}</span>
        <Checkbox
          id="detection-enabled"
          checked={held.enabled}
          onChange={(checked) =>
            void send(enabledWrite(checked), enabledWrite(held.enabled))
          }
        />
      </label>
      <p className="note">{t("connectPage.settings.detection.enabledNote")}</p>
      {held.enabled ? null : (
        <p className="note">{t("settings.routeMatchingOff")}</p>
      )}
      <ul className="settings-list">
        {DETECTION_FIELDS.map((field) => {
          const draft = drafts[field.key] ?? String(field.read(held));
          const commit = () => {
            const write = detectionWrite(held, field.key, draft);
            if (write.ok) {
              // Undo sends the record as the phone held it before this edit.
              void send(write, {
                method: write.method,
                params:
                  field.group === "strictness"
                    ? held.strictness
                    : held.sectionConfig,
              });
            } else {
              clearRefusal();
              setNotice(write.error ? { key: write.error } : null);
              if (!write.error) setDrafts({});
            }
          };
          return (
            <li key={field.key} className="settings-row">
              <TextField
                id={`detection-${field.key}`}
                label={t(field.label)}
                inputMode="decimal"
                value={draft}
                onChange={(next) =>
                  setDrafts((current) => ({ ...current, [field.key]: next }))
                }
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit();
                }}
              />
            </li>
          );
        })}
      </ul>
      {notice || refusal ? (
        <p id="detection-notice" role="alert">
          {notice ? t(notice.key) : refusal}
        </p>
      ) : null}
    </div>
  );
}
