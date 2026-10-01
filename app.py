"""ONE SET. — a Streamlit prototype of the daily macro log.

The CSV belongs to the person using the app. They upload it (or start a new
log), edit it in this session, and download the updated file. Streamlit
Community Cloud discards files written at runtime, so this app never stores
the log on the server and never invents a zero row for a missing day.

The installed product is meant to be a PWA. This file is the prototype:
session memory, tabs instead of a bottom bar, and the system number input
instead of a custom keypad.
"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import streamlit as st

import macro_logic as logic

SAMPLE_PATH = Path(__file__).with_name("sample_macro_log.csv")
CHART_PRESETS = ("7 days", "14 days", "30 days", "90 days", "All history", "Custom")
COMPARE_CHOICES = ("4", "8", "12", "26", "All")
ONLY_COPY = "The file you download is your only copy. This app does not keep one."


def main() -> None:
    st.set_page_config(
        page_title="ONE SET.",
        page_icon="●",
        layout="centered",
        initial_sidebar_state="collapsed",
    )
    _init_state()
    st.title("ONE SET.")
    st.caption(ONLY_COPY)

    if st.session_state.log_df is None:
        _render_welcome()
        return

    ranges = _active_ranges()
    if ranges is None:
        st.error("Each target needs a low gram value and a high one that is at least as large. The charts are using 125–250 g until that is fixed.")
        ranges = logic.default_ranges()

    log_tab, trends_tab, week_tab, export_tab = st.tabs(["Log", "Trends", "Week", "Export"])
    with log_tab:
        _render_log()
    with trends_tab:
        _render_trends(st.session_state.log_df, ranges)
    with week_tab:
        _render_week(st.session_state.log_df, ranges)
    with export_tab:
        _render_export(st.session_state.log_df, ranges)


def _init_state() -> None:
    defaults = {
        "log_df": None,
        "log_warnings": [],
        "log_source": None,
        "log_generation": 0,
        "welcome_token": None,
        "replace_token": None,
        "confirm_clear": False,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def _render_welcome() -> None:
    st.header("Log")
    st.markdown(
        "Upload the CSV from last time, or start a new log. "
        "Each person keeps their own file, so a shared link does not mix histories. "
        "Blank cells stay blank. Missing days are not filled with zeros."
    )
    generation = st.session_state.log_generation
    uploaded = st.file_uploader(
        "Upload my CSV",
        type=["csv"],
        key=f"welcome_upload_{generation}",
        help="Columns: Date, Protein, Carbs, Fat, Calories. protein_g, carbs_g, fat_g, and kcal are accepted too.",
    )
    if uploaded is not None and _ingest(uploaded, "welcome_token"):
        st.rerun()

    if st.button("Start fresh", width="stretch"):
        st.session_state.log_df = logic.empty_log()
        st.session_state.log_warnings = []
        st.session_state.log_source = None
        st.rerun()

    st.download_button(
        "Download a blank sample",
        data=_sample_csv_bytes(),
        file_name="sample_macro_log.csv",
        mime="text/csv",
        width="stretch",
        help="Fake numbers you can upload to see the layout. Not your history.",
    )


def _render_log() -> None:
    frame: pd.DataFrame = st.session_state.log_df
    for warning in st.session_state.log_warnings:
        st.warning(warning)
    source = st.session_state.log_source or "New log, not saved to a file yet"
    st.markdown(f"**{source}**")
    st.caption(logic.log_span_text(frame))
    st.caption(ONLY_COPY)

    today = date.today()
    selected = st.date_input(
        "Date",
        value=today,
        min_value=date(2010, 1, 1),
        max_value=today + timedelta(days=14),
        key="edit_date",
    )
    if isinstance(selected, tuple):
        selected = selected[0]
    existing = logic.values_for_date(frame, selected)
    if existing is None:
        st.caption(f"{selected.isoformat()} is not logged yet. Empty fields stay blank, not zero.")
    else:
        st.caption(f"{selected.isoformat()} is already logged. Saving replaces that day.")

    iso = selected.isoformat()
    protein = st.number_input(
        "Protein (g)",
        min_value=0.0,
        value=_input_value(existing, "Protein"),
        step=0.01,
        format="%.2f",
        key=f"protein_{iso}",
        placeholder="Blank if not tracked",
    )
    carbs = st.number_input(
        "Carbs (g)",
        min_value=0.0,
        value=_input_value(existing, "Carbs"),
        step=0.01,
        format="%.2f",
        key=f"carbs_{iso}",
        placeholder="Blank if not tracked",
    )
    fat = st.number_input(
        "Fat (g)",
        min_value=0.0,
        value=_input_value(existing, "Fat"),
        step=0.01,
        format="%.2f",
        key=f"fat_{iso}",
        placeholder="Blank if not tracked",
    )
    calories = st.number_input(
        "Calories",
        min_value=0.0,
        value=_input_value(existing, "Calories"),
        step=0.01,
        format="%.2f",
        key=f"calories_{iso}",
        placeholder="Blank uses the macro total",
        help="Calculated as 4×protein + 4×carbs + 9×fat when all three are filled. Type a number to keep a different total.",
    )
    _calorie_caption(protein, carbs, fat, calories)

    if st.button("Save day", type="primary", width="stretch"):
        _save_log_day(selected, protein, carbs, fat, calories)


def _calorie_caption(protein: float | None, carbs: float | None, fat: float | None, calories: float | None) -> None:
    # The first call, before the calories widget exists, only introduces the rule.
    # The second call, with the widget's current value, says whether it matches.
    calculated = logic.calories_from_macros(protein, carbs, fat)
    if calories is None and calculated is None:
        st.caption("Calories use 4×protein + 4×carbs + 9×fat once protein, carbs, and fat are all filled. Until then a blank stays blank.")
        return
    if calculated is None:
        st.caption("A calorie number typed here is kept. The macro total needs all three macros.")
        return
    total = logic.format_number(calculated)
    if calories is None:
        st.caption(f"Leave calories blank to save {total} kcal from the macros, or type a number to override it.")
        return
    if abs(float(calories) - calculated) <= 0.05:
        st.caption(f"{total} kcal matches 4×protein + 4×carbs + 9×fat.")
        return
    st.caption(f"Manual calories. The macro total is {total} kcal. Clear the field and save to use that instead.")


def _save_log_day(selected: date, protein: float | None, carbs: float | None, fat: float | None, calories: float | None) -> None:
    try:
        updated, status = logic.save_day(
            st.session_state.log_df,
            selected,
            {"Protein": protein, "Carbs": carbs, "Fat": fat, "Calories": calories},
        )
    except logic.MacroLogError as exc:
        st.error(str(exc))
        return
    st.session_state.log_df = updated
    if status == "saved":
        st.success(f"Saved {selected.isoformat()}. Download the CSV on the Export tab before you leave.")
    elif status == "cleared":
        st.success(f"Cleared {selected.isoformat()}. Blank fields were removed instead of stored as zeros.")
    else:
        st.info("Nothing was saved. Enter at least one number. An empty field is not zero.")


def _render_trends(frame: pd.DataFrame, ranges: dict[str, tuple[float, float]]) -> None:
    st.caption(ONLY_COPY)
    st.caption(
        "Protein is a solid line with circles, carbs a dashed line with squares, "
        "and fat a dotted line with triangles. Dotted guides are each macro's own range. "
        "A missing day breaks the line. It is not drawn as zero."
    )
    if frame.empty:
        st.caption("Log 2 days to see a trend line.")
        return

    preset = st.selectbox("Chart range", CHART_PRESETS, index=2, key="chart_range")
    start, end = _chart_bounds(frame, preset)
    if start is None or end is None:
        return
    if start > end:
        st.error("The chart start date is after the end date.")
        return

    window = logic.slice_dates(frame, start, end)
    macro_days = int(window[logic.MACRO_COLUMNS].notna().any(axis=1).sum()) if not window.empty else 0
    st.caption(
        f"{len(window)} saved days from {start.isoformat()} to {end.isoformat()}. "
        + _range_text(ranges)
    )
    if macro_days < 2:
        st.caption("Log 2 days with protein, carbs, or fat to see a trend line. Blank cells stay blank.")

    theme = _theme_name()
    st.altair_chart(
        logic.build_macro_chart(window, start, end, ranges, theme=theme),
        width="stretch",
    )
    calorie_chart = logic.build_calorie_chart(window, start, end, theme=theme)
    if calorie_chart is not None:
        st.markdown("**Calories**")
        st.altair_chart(calorie_chart, width="stretch")

    logged = window.loc[window[logic.NUMERIC_COLUMNS].notna().any(axis=1), "Date"]
    if logged.empty:
        return
    choices = list(dict.fromkeys(logged.dt.date.tolist()))
    chosen = st.selectbox(
        "Day",
        choices,
        index=len(choices) - 1,
        format_func=lambda day: day.strftime("%a, %b %d"),
        key="inspect_day",
    )
    values = logic.values_for_date(frame, chosen)
    if values is not None:
        st.caption(_day_text(values))


def _render_week(frame: pd.DataFrame, ranges: dict[str, tuple[float, float]]) -> None:
    st.caption(ONLY_COPY)
    _render_target_inputs()
    weeks = logic.available_weeks(frame)
    if not weeks:
        st.caption("Save a day to see a week. No entries yet.")
        return

    selected_week = st.selectbox(
        "Week",
        weeks,
        format_func=lambda monday: f"{monday.strftime('%b %d')} – {(monday + timedelta(days=6)).strftime('%b %d, %Y')}",
        key="week_select",
        help="Weeks start on Monday. Only weeks with a saved day are listed.",
    )
    week_rows = logic.rows_in_week(frame, selected_week)
    summary = logic.weekly_summary(frame, selected_week, ranges)
    st.caption(f"{len(week_rows)} of 7 days logged. {_range_text(ranges)} Blank days are left out of the average, the minimum, and the count.")
    st.dataframe(logic.format_summary(summary), width="stretch", hide_index=True, key="week_summary_table")

    previous_monday, comparison = logic.format_previous_week(frame, selected_week, ranges)
    if previous_monday is None:
        st.caption("Log another week to compare averages. Up and down are not scored as good or bad.")
    else:
        previous_label = f"{previous_monday.strftime('%b %d')} – {(previous_monday + timedelta(days=6)).strftime('%b %d')}"
        st.markdown(f"**Vs previous week ({previous_label})**")
        st.caption("The arrow is only the direction of the change. It is not colored, because more is not automatically better.")
        st.dataframe(comparison, width="stretch", hide_index=True, key="previous_week_table")

    theme = _theme_name()
    week_end = selected_week + timedelta(days=6)
    st.altair_chart(
        logic.build_macro_chart(week_rows, selected_week, week_end, ranges, theme=theme),
        width="stretch",
    )
    week_calories = logic.build_calorie_chart(week_rows, selected_week, week_end, theme=theme)
    if week_calories is not None:
        st.altair_chart(week_calories, width="stretch")

    _render_longer_comparison(frame, ranges)


def _render_target_inputs() -> None:
    st.markdown("**Target ranges**")
    st.caption(
        "Days in range and the dotted guides use these gram bands. "
        "They start at 125–250 g. Fat in a typical week is often below 125 g, "
        "so that band can show 0 days until you set one that fits, such as 50–90 g."
    )
    for column, (low, high) in logic.default_ranges().items():
        st.number_input(
            f"{column} low (g)",
            min_value=0.0,
            value=float(low),
            step=1.0,
            key=f"target_{column}_low",
        )
        st.number_input(
            f"{column} high (g)",
            min_value=0.0,
            value=float(high),
            step=1.0,
            key=f"target_{column}_high",
        )


def _render_longer_comparison(frame: pd.DataFrame, ranges: dict[str, tuple[float, float]]) -> None:
    st.markdown("**Recent weeks**")
    comparison = logic.weekly_averages(frame)
    if comparison.empty:
        return
    choice = st.selectbox(
        "Weeks to compare",
        COMPARE_CHOICES,
        index=2,
        key="compare_count",
        help="Change is versus the previous week that has a saved day, not a filled-in zero week.",
    )
    count = None if choice == "All" else int(choice)
    visible = logic.recent_weeks(comparison, count)
    st.caption(f"{len(visible)} logged weeks. A week with no saved day is skipped, not entered as zero.")
    st.dataframe(logic.format_comparison(visible), width="stretch", hide_index=True, key="comparison_table")
    if len(visible) < 2:
        return
    chart_frame = visible.rename(columns={"Week start": "Date"})
    start = chart_frame["Date"].min().date()
    end = chart_frame["Date"].max().date()
    # Weekly points only. Filling every calendar day would break the line between Mondays.
    st.altair_chart(
        logic.build_macro_chart(
            chart_frame,
            start,
            end,
            ranges,
            theme=_theme_name(),
            fill_missing_days=False,
        ),
        width="stretch",
    )


def _render_export(frame: pd.DataFrame, ranges: dict[str, tuple[float, float]]) -> None:
    st.warning(
        "This session has your only copy. There is no account and no cloud log. "
        "Download the full CSV and keep it somewhere you can upload next time."
    )
    payload = logic.to_csv_bytes(frame)
    stamp = date.today().isoformat()
    st.caption(f"{len(frame)} rows · {len(payload)} bytes")
    st.download_button(
        "Download full log (CSV)",
        data=payload,
        file_name=f"macro_log_{stamp}.csv",
        mime="text/csv",
        width="stretch",
        key="download_log",
    )
    st.caption("That file is the full log. Upload it the next time you open the app.")

    weeks = logic.available_weeks(frame)
    if not weeks:
        st.caption("Save a day before exporting a weekly summary.")
    else:
        selected_week = st.session_state.get("week_select", weeks[0])
        if selected_week not in weeks:
            selected_week = weeks[0]
        summary = logic.weekly_summary(frame, selected_week, ranges)
        week_rows = logic.rows_in_week(frame, selected_week)
        label = selected_week.strftime("%b %d, %Y")
        file_stamp = selected_week.strftime("%Y_%m_%d")
        st.markdown(f"**Week of {label}**")
        summary_csv = logic.format_summary(summary, missing="").to_csv(index=False).encode("utf-8")
        st.download_button(
            "Download weekly summary CSV",
            data=summary_csv,
            file_name=f"macro_summary_{file_stamp}.csv",
            mime="text/csv",
            width="stretch",
            key=f"summary_csv_{file_stamp}",
        )
        pdf = logic.build_summary_pdf(summary, label, week_rows, ranges)
        if pdf is None:
            st.info("PDF export needs the reportlab package (`pip install reportlab`). The CSV downloads still work.")
        else:
            st.download_button(
                "Download weekly summary PDF",
                data=pdf,
                file_name=f"macro_summary_{file_stamp}.pdf",
                mime="application/pdf",
                width="stretch",
                key=f"summary_pdf_{file_stamp}",
            )

    with st.expander(f"History ({len(frame)} saved days)"):
        if frame.empty:
            st.caption("Nothing saved yet.")
        else:
            st.dataframe(logic.history_table(frame), width="stretch", hide_index=True, key="history_table")
            st.caption("Empty cells were blank in the CSV. They are not zeros.")

    st.markdown("**Replace or clear**")
    st.caption("Download the full log first if you want to keep edits from this session.")
    generation = st.session_state.log_generation
    replacement = st.file_uploader(
        "Upload a different CSV",
        type=["csv"],
        key=f"replace_upload_{generation}",
    )
    if replacement is not None and _ingest(replacement, "replace_token"):
        st.rerun()
    if st.button("Clear this session", width="stretch"):
        st.session_state.confirm_clear = True
    if st.session_state.confirm_clear:
        st.caption("Clearing removes the log from this session only. The downloaded file is unaffected.")
        if st.button("Clear anyway", width="stretch"):
            _clear_session()
            st.rerun()
        if st.button("Cancel", width="stretch"):
            st.session_state.confirm_clear = False
            st.rerun()


def _chart_bounds(frame: pd.DataFrame, preset: str) -> tuple[date | None, date | None]:
    if preset == "Custom":
        default = logic.trailing_window(frame, 30)
        if default is None:
            return None, None
        chosen = st.date_input(
            "Custom range",
            value=default,
            min_value=date(2010, 1, 1),
            max_value=date.today() + timedelta(days=14),
            key="custom_range",
        )
        if isinstance(chosen, tuple) and len(chosen) == 2:
            return chosen[0], chosen[1]
        if isinstance(chosen, tuple) and len(chosen) == 1:
            return chosen[0], chosen[0]
        return default
    if preset == "All history":
        return frame["Date"].min().date(), frame["Date"].max().date()
    days = {"7 days": 7, "14 days": 14, "30 days": 30, "90 days": 90}[preset]
    window = logic.trailing_window(frame, days)
    if window is None:
        return None, None
    return window


def _active_ranges() -> dict[str, tuple[float, float]] | None:
    raw: dict[str, tuple[float, float]] = {}
    for column, (low, high) in logic.default_ranges().items():
        raw[column] = (
            float(st.session_state.get(f"target_{column}_low", low)),
            float(st.session_state.get(f"target_{column}_high", high)),
        )
    try:
        return logic.normalize_ranges(raw)
    except (TypeError, ValueError, logic.MacroLogError):
        return None


def _theme_name() -> str:
    try:
        name = st.context.theme.type
    except Exception:
        return "dark"
    if str(name).lower() == "light":
        return "light"
    return "dark"


def _range_text(ranges: dict[str, tuple[float, float]]) -> str:
    parts = [
        f"{column} {logic.format_number(low)}–{logic.format_number(high)} g"
        for column, (low, high) in ranges.items()
    ]
    return "Ranges: " + ", ".join(parts) + "."


def _day_text(values: dict[str, float | None]) -> str:
    def show(column: str) -> str:
        value = values[column]
        if value is None:
            return "—"
        return logic.format_number(value)

    return f"P {show('Protein')} · C {show('Carbs')} · F {show('Fat')} · {show('Calories')} kcal"


def _input_value(existing: dict[str, float | None] | None, column: str) -> float | None:
    if not existing:
        return None
    value = existing.get(column)
    if value is None:
        return None
    return float(value)


def _ingest(uploaded, token_key: str) -> bool:
    """Load an upload once. A bad file changes nothing."""
    payload = uploaded.getvalue()
    token = hashlib.sha256(payload).hexdigest()
    if st.session_state.get(token_key) == token and st.session_state.log_df is not None:
        return False
    try:
        frame, warnings = logic.load_macro_csv(payload)
    except logic.MacroLogError as exc:
        st.error(str(exc))
        return False
    st.session_state.log_df = frame
    st.session_state.log_warnings = warnings
    st.session_state.log_source = uploaded.name
    st.session_state[token_key] = token
    return True


def _clear_session() -> None:
    st.session_state.log_df = None
    st.session_state.log_warnings = []
    st.session_state.log_source = None
    st.session_state.log_generation += 1
    st.session_state.welcome_token = None
    st.session_state.replace_token = None
    st.session_state.confirm_clear = False


def _sample_csv_bytes() -> bytes:
    if SAMPLE_PATH.is_file():
        return SAMPLE_PATH.read_bytes()
    return (
        b"Date,Protein,Carbs,Fat,Calories\n"
        b"2026-08-24,140,180,55,1850\n"
        b"2026-08-25,160,,,\n"
    )


if __name__ == "__main__":
    main()
