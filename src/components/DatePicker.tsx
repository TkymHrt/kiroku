import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { isDiaryDate, tokyoToday } from "../lib/types";
import {
  WEEKDAYS,
  calendarDayLabel,
  calendarDays,
  calendarKeyDate,
  calendarYears,
  dateKey,
  dateParts,
  monthLength,
  shiftCalendarMonth,
} from "../lib/date-picker";

interface Props {
  value: string;
  onChange: (date: string) => void;
  label?: string;
  disabled?: boolean;
  compact?: boolean;
  triggerText?: string;
}

/** A date chooser, without editable date segments or locale-dependent native input rendering. */
export function DatePicker({
  value,
  onChange,
  label = "日付を選ぶ",
  disabled = false,
  compact = false,
  triggerText,
}: Props) {
  const selectedDate = isDiaryDate(value) ? value : tokyoToday();
  const [open, setOpen] = useState(false);
  const [focusedDate, setFocusedDate] = useState(selectedDate);
  const [today, setToday] = useState(tokyoToday);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const moveFocus = useRef(false);
  const titleId = useId();
  const dialogId = useId();
  const { year, month, day } = dateParts(focusedDate);
  const days = calendarDays(focusedDate);
  const weeks = Array.from({ length: 6 }, (_, index) =>
    days.slice(index * 7, index * 7 + 7),
  );
  const displayDate = selectedDate.replaceAll("-", "/");

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    element
      ?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)
      ?.focus();
    return () => element?.close();
    // Opening always resets focusedDate first. Changing months must not reopen the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    dialog.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)
      ?.focus();
  }, [focusedDate, open]);

  function close() {
    moveFocus.current = false;
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(date: string) {
    close();
    onChange(date);
  }

  function changeMonth(nextYear: number, nextMonth: number) {
    setFocusedDate(
      dateKey(
        nextYear,
        nextMonth,
        Math.min(day, monthLength(nextYear, nextMonth)),
      ),
    );
  }

  function handleCalendarKey(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !(event.target instanceof HTMLButtonElement) ||
      !event.target.dataset.date
    )
      return;
    const next = calendarKeyDate(
      event.target.dataset.date,
      event.key,
      event.shiftKey,
    );
    if (!next) return;
    event.preventDefault();
    moveFocus.current = next !== focusedDate;
    setFocusedDate(next);
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`date-picker-trigger${compact ? " is-compact" : ""}`}
        aria-label={triggerText ? label : `${label}: ${displayDate}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        disabled={disabled}
        onClick={() => {
          setFocusedDate(selectedDate);
          setToday(tokyoToday());
          setOpen(true);
        }}
      >
        <CalendarDays size={17} aria-hidden="true" />
        <span className="date-picker-value">{triggerText ?? displayDate}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            id={dialogId}
            className="date-picker-dialog"
            lang="ja"
            aria-labelledby={titleId}
            onCancel={(event) => {
              event.preventDefault();
              close();
            }}
            onClick={(event) => {
              // A native dialog's backdrop targets the dialog, including outside its bounding box.
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                close();
            }}
          >
            <div className="date-picker-header">
              <h2 id={titleId} className="date-picker-title">
                日付を選ぶ
              </h2>
              <button
                type="button"
                className="date-picker-close"
                aria-label="キャンセル"
                onClick={close}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="date-picker-month-nav">
              <button
                type="button"
                className="date-picker-month-button"
                aria-label="前の月"
                disabled={year === 1 && month === 1}
                onClick={() =>
                  setFocusedDate(shiftCalendarMonth(focusedDate, -1))
                }
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <div className="date-picker-month-selects">
                <select
                  className="date-picker-select date-picker-year"
                  aria-label="年"
                  value={year}
                  onChange={(event) =>
                    changeMonth(Number(event.target.value), month)
                  }
                >
                  {calendarYears(year).map((option) => (
                    <option key={option} value={option}>
                      {option}年
                    </option>
                  ))}
                </select>
                <select
                  className="date-picker-select date-picker-month"
                  aria-label="月"
                  value={month}
                  onChange={(event) =>
                    changeMonth(year, Number(event.target.value))
                  }
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index} value={index + 1}>
                      {index + 1}月
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="date-picker-month-button"
                aria-label="次の月"
                disabled={year === 9999 && month === 12}
                onClick={() =>
                  setFocusedDate(shiftCalendarMonth(focusedDate, 1))
                }
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="date-picker-weekdays" aria-hidden="true">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div
              className="date-picker-grid"
              role="grid"
              aria-label={`${year}年${month}月`}
              onKeyDown={handleCalendarKey}
            >
              {weeks.map((week, index) => (
                <div key={index} className="date-picker-week" role="row">
                  {week.map((date, dayIndex) => (
                    <div
                      key={date ?? `empty-${dayIndex}`}
                      className="date-picker-cell"
                      role="gridcell"
                      aria-selected={date === selectedDate}
                    >
                      {date && (
                        <button
                          type="button"
                          data-date={date}
                          className={`date-picker-day${date === selectedDate ? " is-selected" : ""}${date === today ? " is-today" : ""}${dateParts(date).month !== month ? " is-outside" : ""}`}
                          aria-label={calendarDayLabel(date)}
                          aria-current={date === today ? "date" : undefined}
                          tabIndex={date === focusedDate ? 0 : -1}
                          onClick={() => choose(date)}
                        >
                          {dateParts(date).day}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="date-picker-footer">
              <button
                type="button"
                className="date-picker-today"
                onClick={() => choose(tokyoToday())}
              >
                今日
              </button>
              <span className="date-picker-hint">
                {today.replaceAll("-", "/")}
              </span>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
