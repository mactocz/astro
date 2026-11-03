import { Clock, Tag } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { useShiftForm } from "@/components/hooks/useShiftForm";
import { Button } from "@/components/ui/button";
import {
  SHIFT_NAME_MAX_LENGTH,
  endsNextDay,
  formatDuration,
  parseTime,
  shiftDurationMinutes,
} from "@/lib/services/shift";
import type { Shift } from "@/types";

interface Props {
  shift?: Shift;
}

const hintClass = "text-xs text-blue-100/50";
const previewClass = "text-sm text-blue-100/80";
const OVERNIGHT_HINT =
  "Zmiana kończąca się po północy: wpisz godzinę zakończenia wcześniejszą niż rozpoczęcia, np. 22:00–06:00.";

// The line under the time fields: how long the typed shift lasts, or null while the times are not both valid and different.
function durationPreview(startTime: string, endTime: string): string | null {
  const startMinute = parseTime(startTime);
  const endMinute = parseTime(endTime);
  if (startMinute === undefined || endMinute === undefined || startMinute === endMinute) {
    return null;
  }
  const times = { startMinute, endMinute };
  const nextDay = endsNextDay(times) ? ", kończy się następnego dnia" : "";
  return `Czas trwania: ${formatDuration(shiftDurationMinutes(times))}${nextDay}`;
}

export default function ShiftForm({ shift }: Props) {
  const { values, fieldErrors, serverError, pending, setField, submit } = useShiftForm({ shift });
  const preview = durationPreview(values.startTime, values.endTime);

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <FormField
        id="name"
        label="Nazwa"
        value={values.name}
        onChange={(value) => {
          setField("name", value);
        }}
        error={fieldErrors.name}
        maxLength={SHIFT_NAME_MAX_LENGTH}
        icon={<Tag className="size-4" />}
      />

      <FormField
        id="startTime"
        type="time"
        label="Godzina rozpoczęcia"
        value={values.startTime}
        onChange={(value) => {
          setField("startTime", value);
        }}
        error={fieldErrors.startTime}
        icon={<Clock className="size-4" />}
      />

      <FormField
        id="endTime"
        type="time"
        label="Godzina zakończenia"
        value={values.endTime}
        onChange={(value) => {
          setField("endTime", value);
        }}
        error={fieldErrors.endTime}
        icon={<Clock className="size-4" />}
      />

      <p aria-live="polite" className={preview ? previewClass : hintClass}>
        {preview ?? OVERNIGHT_HINT}
      </p>

      <ServerError message={serverError} />

      <div className="flex items-center gap-4 pt-2">
        <Button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {pending ? "Zapisywanie..." : "Zapisz"}
        </Button>
        <a href="/shifts" className="text-sm text-purple-300 hover:underline">
          Anuluj
        </a>
      </div>
    </form>
  );
}
