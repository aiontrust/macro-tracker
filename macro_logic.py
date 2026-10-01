"""In-memory macro log: load, edit, summarize, and export a user-owned CSV.

Blank cells stay missing. They are never coerced to zero. Days that are not in
the file are not invented. Nothing in this module writes a log to disk.
"""

from __future__ import annotations

import importlib
import io
import math
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import BinaryIO, Mapping

os.environ.setdefault("MPLBACKEND", "Agg")

import matplotlib

if matplotlib.get_backend().lower() not in {
    "agg",
    "module://matplotlib.backends.backend_agg",
}:
    matplotlib.use("Agg", force=True)

import altair as alt
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd

CANONICAL_COLUMNS = ["Date", "Protein", "Carbs", "Fat", "Calories"]
REQUIRED_COLUMNS = ["Date", "Protein", "Carbs", "Fat"]
NUMERIC_COLUMNS = ["Protein", "Carbs", "Fat", "Calories"]
MACRO_COLUMNS = ["Protein", "Carbs", "Fat"]
TARGET_LOW = 125.0
TARGET_HIGH = 250.0
MAX_GRAMS = 1000.0
MAX_CALORIES = 20000.0

# Line style and marker are required cues. Color is the third, and it changes
# with the theme so the lines stay readable on near-black and on bone paper.
MACRO_STYLE = {
    "Protein": {
        "dark": "#E8A33A",
        "light": "#9A5A00",
        "dash": [],
        "mpl": "-",
        "marker": "o",
        "shape": "circle",
        "label": "P",
        "width": 2.6,
    },
    "Carbs": {
        "dark": "#6FA8FF",
        "light": "#0069A8",
        "dash": [8, 4],
        "mpl": (0, (8, 4)),
        "marker": "s",
        "shape": "square",
        "label": "C",
        "width": 2.4,
    },
    "Fat": {
        "dark": "#D9D4CA",
        "light": "#3A3A3A",
        "dash": [1.5, 4],
        "mpl": (0, (1.5, 4)),
        "marker": "^",
        "shape": "triangle",
        "label": "F",
        "width": 2.4,
    },
}
CALORIE_COLORS = {"dark": "#C9C4BA", "light": "#4F4B45"}
GUIDE_COLORS = {"dark": "#A19D95", "light": "#8A847C"}

_BLANK_TOKENS = {"", "na", "n/a", "null", "none", "nan", "-", "."}
_NAME_MAP = {
    "date": "Date",
    "protein": "Protein",
    "protein g": "Protein",
    "carbs": "Carbs",
    "carbohydrates": "Carbs",
    "carbs g": "Carbs",
    "fat": "Fat",
    "fat g": "Fat",
    "calories": "Calories",
    "calorie": "Calories",
    "kcal": "Calories",
}
_HEADER_UNITS = re.compile(r"\s*\(.*?\)\s*")


class MacroLogError(ValueError):
    """The uploaded file cannot be used as a macro log."""


def default_ranges() -> dict[str, tuple[float, float]]:
    """Starting gram targets. Each macro can be edited in the app."""
    return {column: (TARGET_LOW, TARGET_HIGH) for column in MACRO_COLUMNS}


def normalize_ranges(ranges: Mapping[str, tuple[float, float]] | None) -> dict[str, tuple[float, float]]:
    """Copy of the targets, filled from the defaults. Low must not exceed high."""
    active = default_ranges()
    if not ranges:
        return active
    for column in MACRO_COLUMNS:
        if column not in ranges:
            continue
        low, high = ranges[column]
        low_value = round(float(low), 2)
        high_value = round(float(high), 2)
        if low_value < 0 or high_value < 0 or low_value > high_value:
            raise MacroLogError(
                f"{column} needs a range from a lower gram value to an equal or higher one."
            )
        active[column] = (low_value, high_value)
    return active


def calories_from_macros(
    protein: float | None,
    carbs: float | None,
    fat: float | None,
) -> float | None:
    """4 kcal/g protein, 4 kcal/g carbs, 9 kcal/g fat.

    Any blank macro makes the total unknown. A blank is not treated as zero.
    """
    parts: list[float] = []
    for value in (protein, carbs, fat):
        if value is None:
            return None
        try:
            if pd.isna(value):
                return None
        except TypeError:
            return None
        parts.append(float(value))
    return round(4 * parts[0] + 4 * parts[1] + 9 * parts[2], 2)


def empty_log() -> pd.DataFrame:
    """A log with the canonical columns and no rows."""
    frame = pd.DataFrame(columns=CANONICAL_COLUMNS)
    return _finalize(frame)


def load_macro_csv(source: bytes | str | Path | BinaryIO) -> tuple[pd.DataFrame, list[str]]:
    """Parse a macro CSV.

    Returns the log and a list of non-fatal warnings (for example, an older
    file that has no Calories column). Raises MacroLogError when the file
    cannot be used safely.
    """
    raw = _read_bytes(source)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise _import_failure(
            "This file is not UTF-8 text. In your spreadsheet, use Save As and choose CSV UTF-8."
        ) from exc

    if not text.strip():
        raise _import_failure(
            "This file is empty. It needs a header row: Date,Protein,Carbs,Fat,Calories."
        )

    try:
        incoming = pd.read_csv(
            io.StringIO(text),
            dtype=str,
            keep_default_na=False,
        )
    except pd.errors.EmptyDataError as exc:
        raise _import_failure(
            "This file has no header row. Expected: Date,Protein,Carbs,Fat,Calories."
        ) from exc
    except pd.errors.ParserError as exc:
        raise _import_failure(
            "This file could not be parsed as a CSV. "
            f"Export it as comma-separated values and try again. ({exc})"
        ) from exc

    if incoming.shape[1] == 1:
        header = str(incoming.columns[0])
        if ";" in header:
            raise _import_failure(
                "This file looks semicolon-separated. Export it as a "
                "comma-separated CSV (Date,Protein,Carbs,Fat,Calories)."
            )
        if "\t" in header:
            raise _import_failure(
                "This file looks tab-separated. Export it as a "
                "comma-separated CSV (Date,Protein,Carbs,Fat,Calories)."
            )

    renamed, warnings = _map_columns(incoming)
    dates, issues = _parse_dates(renamed["Date"])
    numbers: dict[str, pd.Series] = {}
    for column in NUMERIC_COLUMNS:
        parsed, column_issues = _parse_numbers(renamed[column], column)
        numbers[column] = parsed
        issues.extend(column_issues)
    if not any(issue.startswith("Row") and "column Date" in issue for issue in issues):
        issues.extend(_duplicate_issues(dates))
    if issues:
        raise _import_issues(issues)
    frame = pd.DataFrame({"Date": dates, **numbers})
    return _finalize(frame), warnings


def save_day(
    frame: pd.DataFrame,
    day: date | datetime,
    values: Mapping[str, float | None],
) -> tuple[pd.DataFrame, str]:
    """Insert or replace one date. Returns the new log and a status string.

    Status is "saved", "cleared", or "empty". None means blank, not zero.
    A brand-new date with every field blank is not inserted. Saving blanks
    over an existing date removes that date instead of storing zeros.
    Other dates are left untouched.
    """
    target = pd.Timestamp(_as_date(day)).normalize()
    cleaned: dict[str, float] = {}
    for column in NUMERIC_COLUMNS:
        number = _optional_number(values.get(column), column)
        if number is not None:
            if column in MACRO_COLUMNS and number > MAX_GRAMS:
                raise MacroLogError(f"{column} above {format_number(MAX_GRAMS)} g was not saved.")
            if column == "Calories" and number > MAX_CALORIES:
                raise MacroLogError(f"Calories above {format_number(MAX_CALORIES)} were not saved.")
            cleaned[column] = number
    if "Calories" not in cleaned:
        calculated = calories_from_macros(
            cleaned.get("Protein"),
            cleaned.get("Carbs"),
            cleaned.get("Fat"),
        )
        if calculated is not None:
            cleaned["Calories"] = calculated

    working = frame.copy()
    mask = working["Date"] == target
    if not cleaned:
        if bool(mask.any()):
            working = working.loc[~mask]
            return _finalize(working), "cleared"
        return _finalize(working), "empty"

    if bool(mask.any()):
        index = working.index[mask][0]
        for column in NUMERIC_COLUMNS:
            working.at[index, column] = cleaned.get(column, math.nan)
    else:
        row = {column: cleaned.get(column, math.nan) for column in NUMERIC_COLUMNS}
        row["Date"] = target
        working = pd.concat([working, pd.DataFrame([row])], ignore_index=True)
    return _finalize(working), "saved"


def values_for_date(frame: pd.DataFrame, day: date | datetime) -> dict[str, float | None] | None:
    """Return the saved numbers for a date, or None if that date is absent.

    Missing cells are Python None, not 0.
    """
    target = pd.Timestamp(_as_date(day)).normalize()
    match = frame.loc[frame["Date"] == target]
    if match.empty:
        return None
    record = match.iloc[0]
    found: dict[str, float | None] = {}
    for column in NUMERIC_COLUMNS:
        value = record[column]
        found[column] = None if pd.isna(value) else float(value)
    return found


def to_csv_bytes(frame: pd.DataFrame) -> bytes:
    """Serialize the log. Blank cells are empty, never the word nan or 0."""
    exported = frame[CANONICAL_COLUMNS].copy()
    exported["Date"] = pd.to_datetime(exported["Date"]).dt.strftime("%Y-%m-%d")
    for column in NUMERIC_COLUMNS:
        exported[column] = exported[column].map(
            lambda value: "" if pd.isna(value) else format_number(float(value))
        )
    return exported.to_csv(index=False).encode("utf-8")


def monday_of(day: date | datetime) -> date:
    """Monday on or before this date. Weeks run Monday through Sunday."""
    current = _as_date(day)
    return current - timedelta(days=current.weekday())


def available_weeks(frame: pd.DataFrame) -> list[date]:
    """Mondays that contain at least one saved row, newest first."""
    if frame.empty:
        return []
    mondays = {monday_of(stamp.date()) for stamp in frame["Date"]}
    return sorted(mondays, reverse=True)


def rows_in_week(frame: pd.DataFrame, week_monday: date | datetime) -> pd.DataFrame:
    """Saved rows from Monday through Sunday. Missing days are not added."""
    start = pd.Timestamp(monday_of(week_monday))
    end = start + pd.Timedelta(days=6)
    selected = frame.loc[(frame["Date"] >= start) & (frame["Date"] <= end)].copy()
    return selected.reset_index(drop=True)


def weekly_summary(
    frame: pd.DataFrame,
    week_monday: date | datetime,
    ranges: Mapping[str, tuple[float, float]] | None = None,
) -> pd.DataFrame:
    """Average, min, max, and days inside each macro's own gram range.

    Blank cells are skipped. They do not become 0, and they do not count as
    days in range. When a macro was not logged at all that week, its
    average, min, max, and days-in-range are missing rather than 0. Calories
    are summarized the same way, except they are not scored against a gram range.
    """
    active = normalize_ranges(ranges)
    week = rows_in_week(frame, week_monday)
    rows: list[dict[str, object]] = []
    for column in NUMERIC_COLUMNS:
        logged = week[column].dropna()
        if logged.empty:
            average = minimum = maximum = in_target = None
        else:
            average = float(logged.mean())
            minimum = float(logged.min())
            maximum = float(logged.max())
            if column == "Calories":
                in_target = None
            else:
                low, high = active[column]
                in_target = int(((logged >= low) & (logged <= high)).sum())
        rows.append(
            {
                "Macro": column,
                "Average": average,
                "Min": minimum,
                "Max": maximum,
                "Days in target": in_target,
                "Days logged": int(logged.shape[0]),
            }
        )
    return pd.DataFrame(rows)


def previous_logged_week(frame: pd.DataFrame, week_monday: date | datetime) -> date | None:
    """The newest saved week that starts before this Monday, if there is one."""
    current = monday_of(week_monday)
    older = [week for week in available_weeks(frame) if week < current]
    return older[0] if older else None


def weekly_averages(frame: pd.DataFrame) -> pd.DataFrame:
    """One row per logged week, oldest first, with the change from the prior logged week.

    Weeks with no saved rows are omitted. A blank week is not inserted as zeros.
    The change is against the previous week that actually has a row, and is
    missing when that macro was blank in either week.
    """
    change_columns = [f"{column} change" for column in NUMERIC_COLUMNS]
    columns = ["Week start", *NUMERIC_COLUMNS, *change_columns]
    if frame.empty:
        return pd.DataFrame(columns=columns)

    working = frame.copy()
    working["Week start"] = working["Date"].map(lambda stamp: pd.Timestamp(monday_of(stamp)))
    grouped = (
        working.groupby("Week start", as_index=False)[NUMERIC_COLUMNS]
        .mean(numeric_only=True)
        .sort_values("Week start")
        .reset_index(drop=True)
    )
    for column in NUMERIC_COLUMNS:
        grouped[f"{column} change"] = grouped[column].diff()
    return grouped[columns]


def recent_weeks(comparison: pd.DataFrame, count: int | None) -> pd.DataFrame:
    """Last `count` logged weeks. None keeps every week. Changes stay intact."""
    if count is None or comparison.empty:
        return comparison.copy().reset_index(drop=True)
    return comparison.tail(int(count)).reset_index(drop=True)


def slice_dates(
    frame: pd.DataFrame,
    start: date | datetime,
    end: date | datetime,
) -> pd.DataFrame:
    """Rows inside an inclusive date range. Does not fill missing days."""
    start_stamp = pd.Timestamp(_as_date(start)).normalize()
    end_stamp = pd.Timestamp(_as_date(end)).normalize()
    if end_stamp < start_stamp:
        raise MacroLogError("The end date is before the start date.")
    selected = frame.loc[
        (frame["Date"] >= start_stamp) & (frame["Date"] <= end_stamp)
    ].copy()
    return selected.reset_index(drop=True)


def trailing_window(frame: pd.DataFrame, days: int) -> tuple[date, date] | None:
    """Inclusive window of `days` calendar days ending on the latest saved date."""
    if frame.empty:
        return None
    if days < 1:
        raise MacroLogError("The chart window must cover at least one day.")
    end = frame["Date"].max().date()
    start = end - timedelta(days=days - 1)
    earliest = frame["Date"].min().date()
    if start < earliest:
        start = earliest
    return start, end


def history_table(frame: pd.DataFrame) -> pd.DataFrame:
    """Newest-first table with blank cells as empty strings, for display only."""
    view = frame[CANONICAL_COLUMNS].sort_values("Date", ascending=False).copy()
    view["Date"] = pd.to_datetime(view["Date"]).dt.strftime("%Y-%m-%d")
    for column in NUMERIC_COLUMNS:
        view[column] = view[column].map(
            lambda value: "" if pd.isna(value) else format_number(float(value))
        )
    return view.reset_index(drop=True)


def format_summary(summary: pd.DataFrame, *, missing: str = "—") -> pd.DataFrame:
    """Round a weekly summary for display. Missing stats stay missing, not 0."""
    rows = []
    for record in summary.to_dict(orient="records"):
        rows.append(
            {
                "Macro": record["Macro"],
                "Average": _format_stat(record["Average"], missing),
                "Min": _format_stat(record["Min"], missing),
                "Max": _format_stat(record["Max"], missing),
                "In range": _format_ratio(record["Days in target"], record["Days logged"], missing),
            }
        )
    return pd.DataFrame(rows)


def format_previous_week(
    frame: pd.DataFrame,
    week_monday: date | datetime,
    ranges: Mapping[str, tuple[float, float]] | None = None,
    *,
    missing: str = "—",
) -> tuple[date | None, pd.DataFrame]:
    """This week's averages against the previous logged week.

    The change is text with an arrow and a sign. It is not colored, because
    up is not automatically good and down is not automatically bad.
    """
    current = weekly_summary(frame, week_monday, ranges).set_index("Macro")
    previous_monday = previous_logged_week(frame, week_monday)
    previous = None
    if previous_monday is not None:
        previous = weekly_summary(frame, previous_monday, ranges).set_index("Macro")
    rows = []
    for column in NUMERIC_COLUMNS:
        this_average = current.loc[column, "Average"]
        previous_average = None if previous is None else previous.loc[column, "Average"]
        change = percent = missing
        if not _is_missing_value(this_average) and not _is_missing_value(previous_average):
            delta = float(this_average) - float(previous_average)
            change = _format_direction(delta, missing)
            if float(previous_average) == 0:
                percent = missing
            else:
                percent = f"{(delta / float(previous_average)) * 100:+.1f}%"
        rows.append(
            {
                "Macro": column,
                "This week": _format_stat(this_average, missing),
                "Previous": _format_stat(previous_average, missing),
                "Change": change,
                "Percent": percent,
            }
        )
    return previous_monday, pd.DataFrame(rows)


def format_comparison(comparison: pd.DataFrame, *, missing: str = "—") -> pd.DataFrame:
    """Newest-first weekly averages and the change versus the previous logged week."""
    if comparison.empty:
        return pd.DataFrame(
            columns=[
                "Week of",
                "Protein",
                "Protein Δ",
                "Carbs",
                "Carbs Δ",
                "Fat",
                "Fat Δ",
                "Calories",
                "Calories Δ",
            ]
        )
    newest_first = comparison.sort_values("Week start", ascending=False)
    rows = []
    for record in newest_first.to_dict(orient="records"):
        row: dict[str, str] = {
            "Week of": pd.Timestamp(record["Week start"]).strftime("%b %d, %Y")
        }
        for column in NUMERIC_COLUMNS:
            row[column] = _format_stat(record[column], missing)
            row[f"{column} Δ"] = _format_direction(record[f"{column} change"], missing)
        rows.append(row)
    return pd.DataFrame(rows)


def format_number(value: float) -> str:
    """Up to two decimal places, without trailing zeros."""
    rounded = round(float(value), 2)
    if math.isclose(rounded, round(rounded), abs_tol=1e-9):
        return str(int(round(rounded)))
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def log_span_text(frame: pd.DataFrame) -> str:
    if frame.empty:
        return "Empty log. Save a day, then download the CSV."
    start = frame["Date"].min().strftime("%Y-%m-%d")
    end = frame["Date"].max().strftime("%Y-%m-%d")
    days = len(frame)
    noun = "day" if days == 1 else "days"
    return f"{days} saved {noun} · {start} to {end}"


def has_macro_values(frame: pd.DataFrame) -> bool:
    if frame.empty:
        return False
    return bool(frame[MACRO_COLUMNS].notna().any().any())


def has_calorie_values(frame: pd.DataFrame) -> bool:
    if frame.empty:
        return False
    return bool(frame["Calories"].notna().any())


def guide_levels(ranges: Mapping[str, tuple[float, float]] | None = None) -> list[tuple[str, float]]:
    """Unique gram guides for the active ranges, lowest first."""
    active = normalize_ranges(ranges)
    found: dict[float, str] = {}
    for low, high in active.values():
        for value in (low, high):
            key = round(float(value), 2)
            found.setdefault(key, f"{format_number(key)}g")
    return [(label, value) for value, label in sorted(found.items())]


def daily_plot_frame(frame: pd.DataFrame, start: date | datetime, end: date | datetime) -> pd.DataFrame:
    """One row per calendar day in the window, for drawing only.

    Days that were never saved, and blank cells, are NaN. They are not zeros.
    The NaN days break chart lines. This frame is not written back to the log.
    """
    start_stamp = pd.Timestamp(_as_date(start)).normalize()
    end_stamp = pd.Timestamp(_as_date(end)).normalize()
    index = pd.date_range(start_stamp, end_stamp, freq="D")
    if frame.empty:
        expanded = pd.DataFrame(index=index)
        for column in NUMERIC_COLUMNS:
            expanded[column] = math.nan
    else:
        indexed = frame.drop_duplicates("Date").set_index("Date").sort_index()
        expanded = indexed.reindex(index)
        for column in NUMERIC_COLUMNS:
            if column not in expanded.columns:
                expanded[column] = math.nan
    expanded.index.name = "Date"
    return expanded.reset_index()


def build_macro_chart(
    frame: pd.DataFrame,
    start: date | datetime,
    end: date | datetime,
    ranges: Mapping[str, tuple[float, float]] | None = None,
    *,
    theme: str = "dark",
    fill_missing_days: bool = True,
):
    """Altair gram chart. Styles and markers differ even if the colors did not.

    Daily charts insert missing dates as blank rows so the line breaks.
    Weekly-average charts pass fill_missing_days=False and keep one point per week.
    """
    alt.data_transformers.disable_max_rows()
    palette_name = "light" if str(theme).lower() == "light" else "dark"
    plot = daily_plot_frame(frame, start, end) if fill_missing_days else frame
    long = plot.melt(
        id_vars=["Date"],
        value_vars=list(MACRO_COLUMNS),
        var_name="Macro",
        value_name="Grams",
    )
    guides = guide_levels(ranges)
    y_values = [float(value) for value in long["Grams"].dropna().tolist()]
    y_values.extend(level for _label, level in guides)
    y_max = max(y_values) * 1.08 if y_values else 300
    y_scale = alt.Scale(domain=[0, max(y_max, 1)])
    layers = []
    if guides:
        guide_frame = pd.DataFrame(
            {"Grams": [level for _label, level in guides], "Guide": [label for label, _level in guides]}
        )
        layers.append(
            alt.Chart(guide_frame)
            .mark_rule(strokeDash=[2, 4], strokeWidth=1, color=GUIDE_COLORS[palette_name])
            .encode(
                y=alt.Y("Grams:Q", scale=y_scale, title="Grams"),
                tooltip=[alt.Tooltip("Guide:N"), alt.Tooltip("Grams:Q", format=".0f")],
            )
        )
    for column in MACRO_COLUMNS:
        style = MACRO_STYLE[column]
        subset = long.loc[long["Macro"] == column]
        color = style[palette_name]
        if subset["Grams"].notna().any():
            line_kwargs = {"color": color, "strokeWidth": style["width"]}
            if style["dash"]:
                line_kwargs["strokeDash"] = style["dash"]
            layers.append(
                alt.Chart(subset)
                .mark_line(**line_kwargs)
                .encode(
                    x=alt.X("Date:T", title=None),
                    y=alt.Y("Grams:Q", scale=y_scale, title="Grams"),
                    tooltip=[
                        alt.Tooltip("Date:T", format="%Y-%m-%d"),
                        alt.Tooltip("Macro:N"),
                        alt.Tooltip("Grams:Q", format=".1f"),
                    ],
                )
            )
            layers.append(
                alt.Chart(subset.dropna(subset=["Grams"]))
                .mark_point(filled=True, size=54, color=color, shape=style["shape"])
                .encode(
                    x=alt.X("Date:T", title=None),
                    y=alt.Y("Grams:Q", scale=y_scale, title="Grams"),
                    tooltip=[
                        alt.Tooltip("Date:T", format="%Y-%m-%d"),
                        alt.Tooltip("Macro:N"),
                        alt.Tooltip("Grams:Q", format=".1f"),
                    ],
                )
            )
            last = subset.dropna(subset=["Grams"]).sort_values("Date").tail(1)
            if not last.empty:
                last = last.copy()
                last["Tag"] = style["label"]
                layers.append(
                    alt.Chart(last)
                    .mark_text(align="left", dx=8, fontSize=13, fontWeight="bold", color=color)
                    .encode(x="Date:T", y="Grams:Q", text="Tag:N")
                )
    if not layers:
        layers.append(alt.Chart(pd.DataFrame({"Grams": [0]})).mark_rule(opacity=0).encode(y="Grams:Q"))
    return alt.layer(*layers).properties(height=280)


def build_calorie_chart(
    frame: pd.DataFrame,
    start: date | datetime,
    end: date | datetime,
    *,
    theme: str = "dark",
):
    """Calorie bars on their own scale. Missing days are omitted, not drawn as zero."""
    if not has_calorie_values(frame):
        return None
    alt.data_transformers.disable_max_rows()
    palette_name = "light" if str(theme).lower() == "light" else "dark"
    plot = daily_plot_frame(frame, start, end)
    bars = plot.dropna(subset=["Calories"])
    if bars.empty:
        return None
    return (
        alt.Chart(bars)
        .mark_bar(color=CALORIE_COLORS[palette_name])
        .encode(
            x=alt.X("Date:T", title=None),
            y=alt.Y("Calories:Q", title="Calories"),
            tooltip=[
                alt.Tooltip("Date:T", format="%Y-%m-%d"),
                alt.Tooltip("Calories:Q", format=".0f"),
            ],
        )
        .properties(height=180)
    )


def build_macro_figure(
    frame: pd.DataFrame,
    title: str,
    ranges: Mapping[str, tuple[float, float]] | None = None,
    *,
    xlabel: str = "Date",
    theme: str = "light",
) -> plt.Figure:
    """Static gram chart used in the PDF. Blank days break the line."""
    palette_name = "light" if str(theme).lower() == "light" else "dark"
    figure, axis = plt.subplots(figsize=(7.2, 4.2))
    plot = frame
    if not frame.empty:
        plot = daily_plot_frame(frame, frame["Date"].min(), frame["Date"].max())
    plotted = False
    for column in MACRO_COLUMNS:
        series = plot[column] if column in plot.columns else pd.Series(dtype=float)
        if series.notna().sum() == 0:
            continue
        style = MACRO_STYLE[column]
        axis.plot(
            plot["Date"],
            series,
            color=style[palette_name],
            linestyle=style["mpl"],
            linewidth=style["width"],
            marker=style["marker"],
            markersize=5,
            label=column,
        )
        plotted = True
    guide_color = GUIDE_COLORS[palette_name]
    for label, level in guide_levels(ranges):
        axis.axhline(
            level,
            color=guide_color,
            linestyle=(0, (2, 4)),
            linewidth=1,
            label=label,
        )
    top_guide = max((level for _label, level in guide_levels(ranges)), default=TARGET_HIGH)
    _finish_chart(figure, axis, title, xlabel, "Grams", plotted, top_guide=top_guide)
    return figure


def build_calorie_figure(frame: pd.DataFrame, title: str, *, xlabel: str = "Date") -> plt.Figure | None:
    """Calories on their own scale. Returns None when every calorie cell is blank."""
    if not has_calorie_values(frame):
        return None
    figure, axis = plt.subplots(figsize=(7.2, 3.4))
    plot = daily_plot_frame(frame, frame["Date"].min(), frame["Date"].max()) if not frame.empty else frame
    axis.plot(
        plot["Date"],
        plot["Calories"],
        color=CALORIE_COLORS["light"],
        linewidth=1.6,
        marker="o",
        markersize=4,
        label="Calories",
    )
    _finish_chart(figure, axis, title, xlabel, "Calories", plotted=True, top_guide=None)
    return figure


def build_summary_pdf(
    summary: pd.DataFrame,
    week_label: str,
    chart_frame: pd.DataFrame | None = None,
    ranges: Mapping[str, tuple[float, float]] | None = None,
) -> bytes | None:
    """PDF of one weekly summary, or None when reportlab is not installed."""
    try:
        importlib.import_module("reportlab.platypus")
        importlib.import_module("reportlab.lib")
        importlib.import_module("reportlab.lib.pagesizes")
        importlib.import_module("reportlab.lib.styles")
        importlib.import_module("reportlab.lib.units")
    except ImportError:
        return None

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Image as ReportImage
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    active = normalize_ranges(ranges)
    range_text = ", ".join(
        f"{column} {format_number(low)}–{format_number(high)} g"
        for column, (low, high) in active.items()
    )
    display = format_summary(summary, missing="—")
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"Macro summary: week of {week_label}", styles["Title"]),
        Spacer(1, 8),
        Paragraph(
            "Blank cells are excluded from every stat. They are not treated as zero. "
            f"In range uses each macro's own targets ({range_text}). "
            "Calories are listed for reference and are not scored against a gram range. "
            "Protein is a solid line with circles, carbs a dashed line with squares, "
            "and fat a dotted line with triangles.",
            styles["Normal"],
        ),
        Spacer(1, 12),
    ]
    header = list(display.columns)
    data = [header] + display.values.tolist()
    table = Table(data, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3a3a3a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#666666")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f4f4")]),
            ]
        )
    )
    story.append(table)
    if chart_frame is not None and has_macro_values(chart_frame):
        chart = build_macro_figure(chart_frame, f"Week of {week_label}", active, theme="light")
        image_buffer = io.BytesIO()
        chart.savefig(image_buffer, format="png", dpi=120, bbox_inches="tight", facecolor="white")
        plt.close(chart)
        image_buffer.seek(0)
        story.append(Spacer(1, 14))
        story.append(ReportImage(image_buffer, width=6.4 * inch, height=3.5 * inch))
    document.build(story)
    buffer.seek(0)
    return buffer.getvalue()


def _finish_chart(figure, axis, title: str, xlabel: str, ylabel: str, plotted: bool, top_guide: float | None) -> None:
    figure.patch.set_facecolor("white")
    axis.set_facecolor("white")
    axis.set_title(title)
    axis.set_xlabel(xlabel)
    axis.set_ylabel(ylabel)
    axis.grid(True, axis="y", color="#e0e0e0", linewidth=0.8)
    axis.spines["top"].set_visible(False)
    axis.spines["right"].set_visible(False)

    y_values: list[float] = []
    for line in axis.get_lines():
        for value in line.get_ydata():
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if math.isnan(number):
                continue
            y_values.append(number)
    if y_values:
        top = max(y_values)
        if top_guide is not None:
            top = max(top, top_guide)
        axis.set_ylim(0, top * 1.08 if top > 0 else 1)
    elif top_guide is not None:
        axis.set_ylim(0, 300)

    if plotted:
        locator = mdates.AutoDateLocator()
        axis.xaxis.set_major_locator(locator)
        axis.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        figure.autofmt_xdate(rotation=30, ha="right")
    axis.legend(
        loc="upper center",
        bbox_to_anchor=(0.5, -0.28),
        ncol=3,
        fontsize=8,
        frameon=False,
    )
    figure.tight_layout()


def _read_bytes(source: bytes | str | Path | BinaryIO) -> bytes:
    if isinstance(source, bytes):
        return source
    if isinstance(source, Path) or (isinstance(source, str) and Path(source).is_file()):
        return Path(source).read_bytes()
    if isinstance(source, str):
        return source.encode("utf-8")
    data = source.read()
    if isinstance(data, str):
        return data.encode("utf-8")
    return data


def _canonical_header(header: str) -> str | None:
    key = str(header).strip().lower().replace("_", " ")
    key = _HEADER_UNITS.sub("", key).strip()
    return _NAME_MAP.get(key)


def _map_columns(incoming: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    warnings: list[str] = []
    kept: dict[str, pd.Series] = {}
    extras: list[str] = []
    for header in incoming.columns:
        name = _canonical_header(str(header))
        series = incoming[header]
        if name is None:
            label = str(header).strip()
            if label == "" or label.lower().startswith("unnamed"):
                if series.map(lambda value: str(value).strip() != "").any():
                    extras.append(label or "(blank header)")
                continue
            extras.append(label)
            continue
        if name in kept:
            raise _import_failure(f"Column {name} appears more than once.")
        kept[name] = series

    missing = [column for column in REQUIRED_COLUMNS if column not in kept]
    if missing:
        found = ", ".join(str(column).strip() or "(blank)" for column in incoming.columns) or "(none)"
        named = ", ".join(f"Missing column: {column}" for column in missing)
        raise _import_failure(
            named
            + ". Expected a header row: Date,Protein,Carbs,Fat,Calories. "
            "Calories may be omitted. date, protein_g, carbs_g, fat_g, and kcal are accepted too. "
            "Found columns: "
            + found
            + "."
        )

    if "Calories" not in kept:
        kept["Calories"] = pd.Series([""] * len(incoming), index=incoming.index)
        warnings.append(
            "No Calories column was found, so calories were left blank. "
            "Older logs without calories still load."
        )
    if extras:
        warnings.append("Ignored extra columns: " + ", ".join(extras) + ".")

    renamed = pd.DataFrame({column: kept[column] for column in CANONICAL_COLUMNS})
    return renamed, warnings


def _parse_dates(series: pd.Series) -> tuple[pd.Series, list[str]]:
    raw = series.map(lambda value: str(value).strip())
    parsed = pd.to_datetime(raw.where(raw != "", pd.NA), format="%Y-%m-%d", errors="coerce")
    issues: list[str] = []
    for index in raw.index:
        row = int(index) + 2
        value = raw.loc[index]
        if value == "":
            issues.append(f"Row {row}, column Date: the date is blank. Use YYYY-MM-DD.")
        elif pd.isna(parsed.loc[index]):
            issues.append(f"Row {row}, column Date: {value!r} is not YYYY-MM-DD.")
    if issues:
        return parsed, issues
    return parsed.dt.normalize(), issues


def _parse_numbers(series: pd.Series, column: str) -> tuple[pd.Series, list[str]]:
    raw = series.map(lambda value: str(value).strip())
    blank = raw.str.lower().isin(_BLANK_TOKENS)
    cleaned = raw.str.replace(",", "", regex=False)
    numbers = pd.to_numeric(cleaned.where(~blank), errors="coerce")
    issues: list[str] = []
    for index in raw.index[list((~blank & numbers.isna()).to_numpy())]:
        issues.append(
            f"Row {int(index) + 2}, column {column}: {raw.loc[index]!r} is not a number."
        )
    negative = numbers < 0
    for index in raw.index[list(negative.fillna(False).to_numpy())]:
        issues.append(
            f"Row {int(index) + 2}, column {column}: {raw.loc[index]!r} is negative."
        )
    limit = MAX_GRAMS if column in MACRO_COLUMNS else MAX_CALORIES
    unit = "g" if column in MACRO_COLUMNS else "kcal"
    too_big = numbers > limit
    for index in raw.index[list(too_big.fillna(False).to_numpy())]:
        issues.append(
            f"Row {int(index) + 2}, column {column}: {raw.loc[index]!r} is above {format_number(limit)} {unit}."
        )
    if bool(numbers.isin([math.inf, -math.inf]).fillna(False).any()):
        issues.append(f"Column {column}: a value is too large to store.")
    return numbers.round(2), issues


def _duplicate_issues(dates: pd.Series) -> list[str]:
    issues: list[str] = []
    if not bool(dates.duplicated(keep=False).any()):
        return issues
    for stamp in sorted(dates[dates.duplicated(keep=False)].unique()):
        rows = [str(int(index) + 2) for index in dates.index[dates == stamp]]
        label = pd.Timestamp(stamp).strftime("%Y-%m-%d")
        issues.append(
            f"Rows {', '.join(rows)}, column Date: {label} is repeated. Each date can appear only once."
        )
    return issues


def _import_failure(message: str) -> MacroLogError:
    text = message.strip()
    if "nothing was imported" not in text.lower():
        text = text.rstrip(".") + ". Nothing was imported."
    return MacroLogError(text)


def _import_issues(issues: list[str]) -> MacroLogError:
    shown = issues[:6]
    lines = "\n".join(f"- {issue}" for issue in shown)
    extra = len(issues) - len(shown)
    if extra:
        lines += f"\n- and {extra} more"
    hint = ""
    if any("is not a number" in issue for issue in issues):
        hint = (
            "\nLeave a cell blank when you did not track it. "
            "Write 0 only when the value was actually 0."
        )
    return MacroLogError(
        "This CSV was not used. Nothing was imported.\n" + lines + hint
    )


def _optional_number(value: object, column: str) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    try:
        number = round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise MacroLogError(f"{column} has to be a number or blank.") from exc
    if math.isnan(number) or math.isinf(number):
        return None
    if number < 0:
        raise MacroLogError(f"{column} cannot be negative.")
    return number


def _finalize(frame: pd.DataFrame) -> pd.DataFrame:
    working = frame.copy()
    for column in CANONICAL_COLUMNS:
        if column not in working.columns:
            working[column] = pd.Series(dtype="float64" if column != "Date" else "datetime64[ns]")
    working = working[CANONICAL_COLUMNS]
    if working.empty:
        working["Date"] = pd.to_datetime(working["Date"])
        for column in NUMERIC_COLUMNS:
            working[column] = pd.to_numeric(working[column])
        return working.reset_index(drop=True)
    working["Date"] = pd.to_datetime(working["Date"]).dt.normalize()
    for column in NUMERIC_COLUMNS:
        working[column] = pd.to_numeric(working[column], errors="coerce").round(2)
    working = working.sort_values("Date", kind="mergesort").reset_index(drop=True)
    return working


def _as_date(value: date | datetime) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    parsed = pd.Timestamp(value)
    return parsed.date()


def _format_stat(value: object, missing: str, *, integer: bool = False, signed: bool = False) -> str:
    if value is None:
        return missing
    try:
        if pd.isna(value):
            return missing
    except TypeError:
        pass
    number = float(value)
    if math.isnan(number):
        return missing
    if integer:
        return str(int(number))
    if signed:
        return f"{number:+.1f}"
    return f"{number:.1f}"


def _is_missing_value(value: object) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except TypeError:
        return False


def _format_ratio(in_target: object, logged: object, missing: str) -> str:
    if _is_missing_value(in_target) or _is_missing_value(logged):
        return missing
    logged_count = int(logged)
    if logged_count == 0:
        return missing
    return f"{int(in_target)}/{logged_count}"


def _format_direction(value: object, missing: str) -> str:
    """Arrow and sign only. No red or green meaning is attached."""
    if _is_missing_value(value):
        return missing
    shown = round(float(value), 1)
    if shown > 0:
        return f"▲ {shown:+.1f}"
    if shown < 0:
        return f"▼ {shown:+.1f}"
    return f"· {shown:+.1f}"
