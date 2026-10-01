"""Data rules: blanks stay blank, missing days are not invented, saves are explicit."""

from __future__ import annotations

import math
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import macro_logic as logic

def _is_missing(value) -> bool:
    """None and NaN both mean a stat was not computed. Zero does not."""
    if value is None:
        return True
    return bool(pd.isna(value))


ROOT = Path(__file__).resolve().parents[1]
REAL = Path("/home/ubuntu/.cursor/projects/workspace/uploads/macro_log_8569.csv")
COMPLETE = Path("/home/ubuntu/.cursor/projects/workspace/uploads/macro_log_complete_only_35f4.csv")
SAMPLE = ROOT / "sample_macro_log.csv"

MIXED = """Date,Protein,Carbs,Fat,Calories
2026-09-07,100,,50,
2026-09-08,200,100,,
2026-09-09,,,40,1800
2026-09-10,150,150,50,2000
2026-09-14,100,100,100,1000
2026-09-15,300,300,100,3000
"""


class LoadTests(unittest.TestCase):
    def test_sample_file_keeps_blanks_and_skips_missing_days(self):
        frame, warnings = logic.load_macro_csv(SAMPLE)
        self.assertEqual(warnings, [])
        self.assertEqual(len(frame), 8)
        self.assertNotIn(pd.Timestamp("2026-08-27"), set(frame["Date"]))
        protein_only = frame.loc[frame["Date"] == pd.Timestamp("2026-08-25")].iloc[0]
        self.assertEqual(protein_only["Protein"], 160)
        self.assertTrue(pd.isna(protein_only["Carbs"]))
        self.assertTrue(pd.isna(protein_only["Fat"]))
        self.assertTrue(pd.isna(protein_only["Calories"]))
        calories_only = frame.loc[frame["Date"] == pd.Timestamp("2026-08-26")].iloc[0]
        self.assertTrue(pd.isna(calories_only["Protein"]))
        self.assertEqual(calories_only["Calories"], 2100)

    def test_older_csv_without_calories_column(self):
        text = "Date,Protein,Carbs,Fat\n2024-01-01,10,20,30\n2024-01-02,11,,\n"
        frame, warnings = logic.load_macro_csv(text)
        self.assertTrue(any("Calories" in warning for warning in warnings))
        self.assertTrue(frame["Calories"].isna().all())
        self.assertTrue(pd.isna(frame.loc[1, "Carbs"]))
        self.assertTrue(pd.isna(frame.loc[1, "Fat"]))
        carbs = frame["Carbs"].dropna()
        self.assertEqual(float(carbs.mean()), 20.0)

    def test_header_is_case_insensitive_and_units_are_stripped(self):
        text = "date,Protein (g),CARBS,Fat,Kcal\n2024-05-01,12.5,30,8,400\n"
        frame, warnings = logic.load_macro_csv(text)
        self.assertEqual(warnings, [])
        self.assertEqual(list(frame.columns), logic.CANONICAL_COLUMNS)
        self.assertEqual(frame.loc[0, "Protein"], 12.5)
        self.assertEqual(frame.loc[0, "Calories"], 400)

    def test_blank_tokens_are_missing_and_zero_is_kept(self):
        text = "Date,Protein,Carbs,Fat,Calories\n2024-06-01,0,NA,n/a,\n"
        frame, _warnings = logic.load_macro_csv(text)
        self.assertEqual(frame.loc[0, "Protein"], 0)
        self.assertTrue(pd.isna(frame.loc[0, "Carbs"]))
        self.assertTrue(pd.isna(frame.loc[0, "Fat"]))
        self.assertTrue(pd.isna(frame.loc[0, "Calories"]))

    def test_export_round_trip_does_not_write_nan_or_fill_zero(self):
        frame, _warnings = logic.load_macro_csv(MIXED)
        exported = logic.to_csv_bytes(frame).decode("utf-8")
        self.assertNotRegex(exported, r"(?i)(^|,)nan(,|$)")
        again, _warnings = logic.load_macro_csv(exported)
        pd.testing.assert_frame_equal(frame, again, check_exact=False, atol=0.001)

    def test_missing_required_column_names_the_header(self):
        with self.assertRaises(logic.MacroLogError) as caught:
            logic.load_macro_csv("Foo,Bar\n1,2\n")
        message = str(caught.exception)
        self.assertIn("Protein", message)
        self.assertIn("Date,Protein,Carbs,Fat,Calories", message)

    def test_bad_date_is_rejected(self):
        text = "Date,Protein,Carbs,Fat\n09/01/2026,1,2,3\n"
        with self.assertRaises(logic.MacroLogError) as caught:
            logic.load_macro_csv(text)
        self.assertIn("YYYY-MM-DD", str(caught.exception))
        self.assertIn("09/01/2026", str(caught.exception))

    def test_non_numeric_cell_is_rejected_and_not_coerced(self):
        text = "Date,Protein,Carbs,Fat\n2024-01-01,lots,2,3\n"
        with self.assertRaises(logic.MacroLogError) as caught:
            logic.load_macro_csv(text)
        self.assertIn("Protein", str(caught.exception))
        self.assertIn("lots", str(caught.exception))
        self.assertIn("blank", str(caught.exception).lower())

    def test_negative_number_is_rejected(self):
        text = "Date,Protein,Carbs,Fat\n2024-01-01,-5,2,3\n"
        with self.assertRaises(logic.MacroLogError) as caught:
            logic.load_macro_csv(text)
        self.assertIn("negative", str(caught.exception))

    def test_duplicate_dates_are_rejected(self):
        text = (
            "Date,Protein,Carbs,Fat\n"
            "2024-01-01,1,2,3\n"
            "2024-01-01,4,5,6\n"
        )
        with self.assertRaises(logic.MacroLogError) as caught:
            logic.load_macro_csv(text)
        self.assertIn("2024-01-01", str(caught.exception))

    def test_empty_file_and_semicolon_file(self):
        with self.assertRaises(logic.MacroLogError) as empty:
            logic.load_macro_csv(b"")
        self.assertIn("empty", str(empty.exception).lower())
        with self.assertRaises(logic.MacroLogError) as semi:
            logic.load_macro_csv("Date;Protein;Carbs;Fat\n2024-01-01;1;2;3\n")
        self.assertIn("semicolon", str(semi.exception).lower())

    def test_header_only_file_is_an_empty_log(self):
        frame, _warnings = logic.load_macro_csv("Date,Protein,Carbs,Fat,Calories\n")
        self.assertTrue(frame.empty)
        self.assertEqual(list(frame.columns), logic.CANONICAL_COLUMNS)


class SaveAndSummaryTests(unittest.TestCase):
    def setUp(self):
        self.frame, _warnings = logic.load_macro_csv(MIXED)

    def test_blanks_do_not_become_zeros_in_weekly_stats(self):
        summary = logic.weekly_summary(self.frame, date(2026, 9, 7))
        protein = summary.loc[summary["Macro"] == "Protein"].iloc[0]
        carbs = summary.loc[summary["Macro"] == "Carbs"].iloc[0]
        fat = summary.loc[summary["Macro"] == "Fat"].iloc[0]
        calories = summary.loc[summary["Macro"] == "Calories"].iloc[0]

        self.assertAlmostEqual(protein["Average"], 150.0)
        self.assertEqual(protein["Min"], 100.0)
        self.assertEqual(protein["Max"], 200.0)
        self.assertEqual(protein["Days in target"], 2)
        self.assertEqual(protein["Days logged"], 3)

        self.assertAlmostEqual(carbs["Average"], 125.0)
        self.assertEqual(carbs["Min"], 100.0)
        self.assertEqual(carbs["Days in target"], 1)
        self.assertEqual(carbs["Days logged"], 2)

        self.assertAlmostEqual(fat["Average"], (50 + 40 + 50) / 3)
        self.assertEqual(fat["Min"], 40.0)
        self.assertEqual(fat["Days in target"], 0)
        self.assertEqual(fat["Days logged"], 3)

        self.assertAlmostEqual(calories["Average"], 1900.0)
        self.assertTrue(_is_missing(calories["Days in target"]))
        self.assertEqual(calories["Days logged"], 2)

        # The old bug treated blanks as 0 and divided by every row.
        self.assertNotAlmostEqual(protein["Average"], (100 + 200 + 0 + 150) / 4)

    def test_week_does_not_invent_missing_days(self):
        week = logic.rows_in_week(self.frame, date(2026, 9, 7))
        self.assertEqual(len(week), 4)
        self.assertNotIn(pd.Timestamp("2026-09-11"), set(week["Date"]))
        self.assertNotIn(pd.Timestamp("2026-09-13"), set(week["Date"]))

    def test_target_bounds_are_inclusive_and_all_blank_macro_is_missing(self):
        text = (
            "Date,Protein,Carbs,Fat,Calories\n"
            "2026-09-07,125,250,124.99,\n"
            "2026-09-08,250.01,124.99,250,\n"
        )
        frame, _warnings = logic.load_macro_csv(text)
        summary = logic.weekly_summary(frame, date(2026, 9, 7))
        protein = summary.loc[summary["Macro"] == "Protein"].iloc[0]
        carbs = summary.loc[summary["Macro"] == "Carbs"].iloc[0]
        fat = summary.loc[summary["Macro"] == "Fat"].iloc[0]
        calories = summary.loc[summary["Macro"] == "Calories"].iloc[0]
        self.assertEqual(protein["Days in target"], 1)  # 125 in, 250.01 out
        self.assertEqual(carbs["Days in target"], 1)  # 250 in, 124.99 out
        self.assertEqual(fat["Days in target"], 1)  # 250 in, 124.99 out
        self.assertTrue(_is_missing(calories["Average"]))
        self.assertTrue(_is_missing(calories["Min"]))
        self.assertTrue(_is_missing(calories["Days in target"]))
        self.assertEqual(calories["Days logged"], 0)

    def test_weeks_start_on_monday_and_skip_empty_weeks(self):
        self.assertEqual(logic.monday_of(date(2026, 9, 13)), date(2026, 9, 7))
        self.assertEqual(logic.monday_of(date(2026, 9, 14)), date(2026, 9, 14))
        weeks = logic.available_weeks(self.frame)
        self.assertEqual(weeks, [date(2026, 9, 14), date(2026, 9, 7)])

    def test_week_over_week_change_ignores_blanks(self):
        comparison = logic.weekly_averages(self.frame)
        self.assertEqual(len(comparison), 2)
        first = comparison.iloc[0]
        second = comparison.iloc[1]
        self.assertTrue(pd.isna(first["Protein change"]))
        self.assertAlmostEqual(second["Protein"], 200.0)
        self.assertAlmostEqual(second["Protein change"], 50.0)
        self.assertAlmostEqual(second["Carbs change"], 75.0)
        self.assertAlmostEqual(second["Calories change"], 100.0)
        # Fat's first week skipped the blank day: (50+40+50)/3, not (50+0+40+50)/4.
        self.assertAlmostEqual(first["Fat"], (50 + 40 + 50) / 3)
        self.assertAlmostEqual(second["Fat change"], 100 - ((50 + 40 + 50) / 3))

    def test_recent_weeks_keeps_the_change_against_the_week_before_the_window(self):
        visible = logic.recent_weeks(logic.weekly_averages(self.frame), 1)
        self.assertEqual(len(visible), 1)
        self.assertAlmostEqual(visible.iloc[0]["Protein change"], 50.0)

    def test_save_updates_only_the_chosen_date_and_keeps_explicit_zero(self):
        updated, status = logic.save_day(
            self.frame,
            date(2026, 9, 11),
            {"Protein": 180, "Carbs": None, "Fat": 0, "Calories": None},
        )
        self.assertEqual(status, "saved")
        self.assertEqual(len(updated), len(self.frame) + 1)
        added = updated.loc[updated["Date"] == pd.Timestamp("2026-09-11")].iloc[0]
        self.assertEqual(added["Protein"], 180)
        self.assertTrue(pd.isna(added["Carbs"]))
        self.assertEqual(added["Fat"], 0)
        self.assertTrue(pd.isna(added["Calories"]))
        original = updated.loc[updated["Date"] == pd.Timestamp("2026-09-07")].iloc[0]
        self.assertEqual(original["Protein"], 100)
        self.assertTrue(pd.isna(original["Carbs"]))

        replaced, status = logic.save_day(
            updated,
            date(2026, 9, 7),
            {"Protein": 110, "Carbs": None, "Fat": None, "Calories": None},
        )
        self.assertEqual(status, "saved")
        row = replaced.loc[replaced["Date"] == pd.Timestamp("2026-09-07")].iloc[0]
        self.assertEqual(row["Protein"], 110)
        self.assertTrue(pd.isna(row["Carbs"]))
        self.assertTrue(pd.isna(row["Fat"]))
        untouched = replaced.loc[replaced["Date"] == pd.Timestamp("2026-09-11")].iloc[0]
        self.assertEqual(untouched["Protein"], 180)

    def test_all_blank_save_does_not_insert_and_clear_removes_the_day(self):
        same, status = logic.save_day(
            self.frame,
            date(2026, 9, 11),
            {"Protein": None, "Carbs": None, "Fat": None, "Calories": None},
        )
        self.assertEqual(status, "empty")
        self.assertEqual(len(same), len(self.frame))

        cleared, status = logic.save_day(
            self.frame,
            date(2026, 9, 10),
            {"Protein": None, "Carbs": None, "Fat": None, "Calories": None},
        )
        self.assertEqual(status, "cleared")
        self.assertNotIn(pd.Timestamp("2026-09-10"), set(cleared["Date"]))
        self.assertIn(pd.Timestamp("2026-09-09"), set(cleared["Date"]))

    def test_explicit_zero_is_included_in_the_average(self):
        frame, _warnings = logic.load_macro_csv(
            "Date,Protein,Carbs,Fat\n2026-09-07,0,10,10\n2026-09-08,100,10,10\n"
        )
        summary = logic.weekly_summary(frame, date(2026, 9, 7))
        protein = summary.loc[summary["Macro"] == "Protein"].iloc[0]
        self.assertAlmostEqual(protein["Average"], 50.0)
        self.assertEqual(protein["Min"], 0.0)
        self.assertEqual(protein["Days logged"], 2)

    def test_slice_does_not_fill_the_calendar(self):
        window = logic.slice_dates(self.frame, date(2026, 9, 7), date(2026, 9, 13))
        self.assertEqual(len(window), 4)
        with self.assertRaises(logic.MacroLogError):
            logic.slice_dates(self.frame, date(2026, 9, 15), date(2026, 9, 7))

    def test_trailing_window_ends_on_the_latest_saved_day(self):
        self.assertEqual(
            logic.trailing_window(self.frame, 90),
            (date(2026, 9, 7), date(2026, 9, 15)),
        )

    def test_display_formats_do_not_print_zero_for_missing_stats(self):
        summary = logic.weekly_summary(self.frame, date(2026, 9, 14))
        # Calories exist, so use a fully blank macro from the first week instead.
        blank_calories = logic.weekly_summary(
            logic.load_macro_csv("Date,Protein,Carbs,Fat\n2026-09-07,10,20,30\n")[0],
            date(2026, 9, 7),
        )
        shown = logic.format_summary(blank_calories)
        calories = shown.loc[shown["Macro"] == "Calories"].iloc[0]
        self.assertEqual(calories["Average"], "—")
        self.assertEqual(calories["Min"], "—")
        self.assertEqual(calories["In range"], "—")
        self.assertNotIn("Days in target", shown.columns)
        self.assertNotIn("Days logged", shown.columns)
        exported = logic.format_summary(blank_calories, missing="")
        self.assertEqual(exported.loc[exported["Macro"] == "Calories", "Average"].iloc[0], "")
        comparison = logic.format_comparison(logic.weekly_averages(self.frame))
        oldest = comparison.iloc[-1]
        self.assertEqual(oldest["Protein Δ"], "—")
        self.assertFalse(summary.empty)

    def test_history_table_prints_blanks_as_empty_strings(self):
        table = logic.history_table(self.frame)
        self.assertEqual(table.iloc[0]["Date"], "2026-09-15")
        protein_gap = table.loc[table["Date"] == "2026-09-09"].iloc[0]
        self.assertEqual(protein_gap["Protein"], "")
        self.assertEqual(protein_gap["Calories"], "1800")
        self.assertNotIn("nan", table.to_csv(index=False).lower())


class ChartAndPdfTests(unittest.TestCase):
    def test_chart_breaks_on_blanks_and_draws_guides(self):
        frame, _warnings = logic.load_macro_csv(MIXED)
        figure = logic.build_macro_figure(frame, "Macros", theme="dark")
        axis = figure.axes[0]
        labels = {line.get_label(): line for line in axis.get_lines()}
        self.assertEqual(labels["Protein"].get_color().lower(), logic.MACRO_STYLE["Protein"]["dark"].lower())
        self.assertEqual(labels["Carbs"].get_color().lower(), logic.MACRO_STYLE["Carbs"]["dark"].lower())
        self.assertEqual(labels["Fat"].get_color().lower(), logic.MACRO_STYLE["Fat"]["dark"].lower())
        self.assertEqual(labels["Protein"].get_marker(), "o")
        self.assertEqual(labels["Carbs"].get_marker(), "s")
        self.assertEqual(labels["Fat"].get_marker(), "^")
        self.assertEqual(labels["Protein"].get_linestyle(), "-")
        self.assertIsNone(labels["Protein"]._dash_pattern[1])
        carbs_dash = labels["Carbs"]._dash_pattern[1]
        fat_dash = labels["Fat"]._dash_pattern[1]
        self.assertGreater(carbs_dash[0], carbs_dash[1])
        self.assertLess(fat_dash[0], fat_dash[1])
        self.assertNotEqual(carbs_dash, fat_dash)
        self.assertEqual([round(value, 1) for value in labels["125g"]._dash_pattern[1]], [2.0, 4.0])
        self.assertEqual([round(value, 1) for value in labels["250g"]._dash_pattern[1]], [2.0, 4.0])
        protein_y = [float(value) for value in labels["Protein"].get_ydata()]
        self.assertTrue(any(math.isnan(value) for value in protein_y))
        self.assertNotIn(0.0, [value for value in protein_y if not math.isnan(value)])
        figure.clf()
        import matplotlib.pyplot as plt

        plt.close("all")

    def test_calorie_chart_has_no_gram_guides(self):
        frame, _warnings = logic.load_macro_csv(MIXED)
        figure = logic.build_calorie_figure(frame, "Calories")
        self.assertIsNotNone(figure)
        labels = [line.get_label() for line in figure.axes[0].get_lines()]
        self.assertIn("Calories", labels)
        self.assertNotIn("125g", labels)
        self.assertNotIn("250g", labels)
        import matplotlib.pyplot as plt

        plt.close("all")

    def test_calorie_chart_is_absent_when_the_column_is_blank(self):
        frame, _warnings = logic.load_macro_csv(
            "Date,Protein,Carbs,Fat\n2024-01-01,10,20,30\n"
        )
        self.assertIsNone(logic.build_calorie_figure(frame, "Calories"))

    def test_pdf_contains_a_document_and_missing_reportlab_returns_none(self):
        frame, _warnings = logic.load_macro_csv(MIXED)
        summary = logic.weekly_summary(frame, date(2026, 9, 7))
        pdf = logic.build_summary_pdf(summary, "Sep 07, 2026")
        self.assertIsNotNone(pdf)
        self.assertTrue(pdf.startswith(b"%PDF"))

        with patch("macro_logic.importlib.import_module", side_effect=ImportError("no reportlab")):
            self.assertIsNone(logic.build_summary_pdf(summary, "Sep 07, 2026"))


class RangeCalorieAndChartTests(unittest.TestCase):
    def test_each_macro_can_use_its_own_range(self):
        frame, _warnings = logic.load_macro_csv(MIXED)
        summary = logic.weekly_summary(
            frame,
            date(2026, 9, 7),
            {"Fat": (50, 90), "Protein": (125, 250), "Carbs": (125, 250)},
        )
        fat = summary.loc[summary["Macro"] == "Fat"].iloc[0]
        self.assertEqual(fat["Days in target"], 2)
        guides = dict(logic.guide_levels({"Fat": (50, 90)}))
        self.assertEqual(set(guides), {"50g", "90g", "125g", "250g"})

    def test_blank_calories_fill_from_macros_and_a_typed_total_wins(self):
        self.assertEqual(logic.calories_from_macros(100, 50, 10), 690)
        self.assertIsNone(logic.calories_from_macros(100, None, 0))
        self.assertEqual(logic.calories_from_macros(100, 50, 0), 600)
        empty = logic.empty_log()
        saved, status = logic.save_day(
            empty,
            date(2026, 9, 1),
            {"Protein": 100, "Carbs": 50, "Fat": 10, "Calories": None},
        )
        self.assertEqual(status, "saved")
        self.assertEqual(saved.iloc[0]["Calories"], 690)
        overridden, status = logic.save_day(
            saved,
            date(2026, 9, 1),
            {"Protein": 100, "Carbs": 50, "Fat": 10, "Calories": 1000},
        )
        self.assertEqual(status, "saved")
        self.assertEqual(overridden.iloc[0]["Calories"], 1000)

    def test_plot_frame_breaks_missing_days_without_writing_them_back(self):
        frame, _warnings = logic.load_macro_csv(MIXED)
        plot = logic.daily_plot_frame(frame, date(2026, 9, 7), date(2026, 9, 15))
        self.assertEqual(len(plot), 9)
        gap = plot.loc[plot["Date"] == pd.Timestamp("2026-09-11")].iloc[0]
        self.assertTrue(pd.isna(gap["Protein"]))
        self.assertNotEqual(gap["Protein"], 0)
        blank_cell = plot.loc[plot["Date"] == pd.Timestamp("2026-09-09")].iloc[0]
        self.assertTrue(pd.isna(blank_cell["Protein"]))
        self.assertNotIn(pd.Timestamp("2026-09-11"), set(frame["Date"]))

    def test_altair_chart_separates_series_by_dash_and_marker(self):
        frame, _warnings = logic.load_macro_csv(MIXED)
        chart = logic.build_macro_chart(
            frame,
            date(2026, 9, 7),
            date(2026, 9, 15),
            theme="dark",
        )
        blob = str(chart.to_dict())
        self.assertIn("#E8A33A", blob)
        self.assertIn("#6FA8FF", blob)
        self.assertIn("#D9D4CA", blob)
        self.assertIn("circle", blob)
        self.assertIn("square", blob)
        self.assertIn("triangle", blob)
        self.assertIn("[8, 4]", blob)
        self.assertIn("[1.5, 4]", blob)
        self.assertIn("[2, 4]", blob)

    def test_import_errors_name_the_row_and_column_and_keep_nothing(self):
        with self.assertRaises(logic.MacroLogError) as caught:
            logic.load_macro_csv("Date,Protein,Carbs,Fat\n2024-01-01,lots,2,3\n")
        message = str(caught.exception)
        self.assertIn("Nothing was imported", message)
        self.assertIn("Row 2, column Protein", message)
        with self.assertRaises(logic.MacroLogError) as duplicate:
            logic.load_macro_csv(
                "Date,Protein,Carbs,Fat\n2024-01-01,1,2,3\n2024-01-01,4,5,6\n"
            )
        self.assertIn("Rows 2, 3, column Date", str(duplicate.exception))
        self.assertIn("Nothing was imported", str(duplicate.exception))

    def test_alias_headers_and_neutral_week_change(self):
        frame, warnings = logic.load_macro_csv(
            "date,protein_g,carbs_g,fat_g,kcal\n2024-05-01,12.5,30,8,400\n"
        )
        self.assertEqual(warnings, [])
        self.assertEqual(frame.loc[0, "Protein"], 12.5)
        self.assertEqual(frame.loc[0, "Calories"], 400)
        mixed, _warnings = logic.load_macro_csv(MIXED)
        shown = logic.format_comparison(logic.weekly_averages(mixed))
        self.assertEqual(shown.iloc[0]["Protein Δ"], "▲ +50.0")
        self.assertEqual(shown.iloc[-1]["Protein Δ"], "—")


@unittest.skipUnless(REAL.is_file(), "attached history is only on the authoring machine")
class RealHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frame, cls.warnings = logic.load_macro_csv(REAL)

    def test_real_file_keeps_blanks_gaps_and_matches_dropna_stats(self):
        raw = pd.read_csv(REAL, dtype=str, keep_default_na=False)
        self.assertEqual(self.warnings, [])
        self.assertEqual(len(self.frame), len(raw))
        self.assertEqual(int(self.frame["Date"].duplicated().sum()), 0)
        span = (self.frame["Date"].max() - self.frame["Date"].min()).days + 1
        self.assertLess(len(self.frame), span)
        for column in logic.NUMERIC_COLUMNS:
            self.assertGreater(int(self.frame[column].isna().sum()), 0)

        saw_partial = False
        saw_blank_macro = False
        for monday in logic.available_weeks(self.frame):
            week = logic.rows_in_week(self.frame, monday)
            summary = logic.weekly_summary(self.frame, monday)
            for column in logic.MACRO_COLUMNS:
                row = summary.loc[summary["Macro"] == column].iloc[0]
                logged = week[column].dropna()
                if logged.empty:
                    self.assertTrue(_is_missing(row["Average"]))
                    self.assertTrue(_is_missing(row["Min"]))
                    self.assertTrue(_is_missing(row["Max"]))
                    self.assertTrue(_is_missing(row["Days in target"]))
                    self.assertEqual(row["Days logged"], 0)
                    saw_blank_macro = True
                    continue
                self.assertAlmostEqual(row["Average"], float(logged.mean()))
                self.assertAlmostEqual(row["Min"], float(logged.min()))
                self.assertAlmostEqual(row["Max"], float(logged.max()))
                if week[column].isna().any():
                    filled = float(week[column].fillna(0).mean())
                    if not math.isclose(filled, float(logged.mean())):
                        self.assertNotAlmostEqual(row["Average"], filled)
                        saw_partial = True
            calories = summary.loc[summary["Macro"] == "Calories"].iloc[0]
            self.assertTrue(_is_missing(calories["Days in target"]))
        self.assertTrue(saw_partial)
        self.assertTrue(saw_blank_macro)

    def test_real_file_round_trip_charts_and_comparison(self):
        again, _warnings = logic.load_macro_csv(logic.to_csv_bytes(self.frame))
        pd.testing.assert_frame_equal(self.frame, again, check_exact=False, atol=0.001)
        self.assertNotRegex(logic.to_csv_bytes(self.frame).decode("utf-8"), r"(?i)(^|,)nan(,|$)")
        window_bounds = logic.trailing_window(self.frame, 90)
        self.assertIsNotNone(window_bounds)
        start, end = window_bounds
        self.assertEqual(end, self.frame["Date"].max().date())
        window = logic.slice_dates(self.frame, start, end)
        self.assertLessEqual(len(window), 90)
        self.assertEqual(window["Date"].max().date(), end)

        figure = logic.build_macro_figure(self.frame, "All history", theme="dark")
        calorie_figure = logic.build_calorie_figure(window, "Recent calories")
        self.assertIsNotNone(calorie_figure)
        chart = logic.build_macro_chart(window, start, end, theme="dark")
        self.assertIn("layer", chart.to_dict())
        comparison = logic.weekly_averages(self.frame)
        self.assertGreaterEqual(len(comparison), 4)
        protein_weeks = comparison["Protein"].dropna()
        logged_zero = bool((self.frame["Protein"].dropna() == 0).any())
        if not logged_zero:
            self.assertFalse((protein_weeks == 0).any())
        visible = logic.recent_weeks(comparison, 8)
        self.assertEqual(len(visible), 8)
        figure.clf()
        calorie_figure.clf()
        import matplotlib.pyplot as plt

        plt.close("all")

        latest_week = logic.available_weeks(self.frame)[0]
        pdf = logic.build_summary_pdf(
            logic.weekly_summary(self.frame, latest_week),
            "Latest week",
            logic.rows_in_week(self.frame, latest_week),
        )
        self.assertTrue(pdf.startswith(b"%PDF"))


@unittest.skipUnless(COMPLETE.is_file(), "complete-days fixture is only on the authoring machine")
class CompleteHistoryTests(unittest.TestCase):
    def test_complete_days_have_no_blanks_and_count_every_logged_day(self):
        raw = pd.read_csv(COMPLETE, dtype=str, keep_default_na=False)
        frame, warnings = logic.load_macro_csv(COMPLETE)
        self.assertEqual(warnings, [])
        self.assertEqual(len(frame), len(raw))
        self.assertGreater(len(frame), 0)
        self.assertEqual(int(frame[logic.NUMERIC_COLUMNS].isna().sum().sum()), 0)
        monday = logic.available_weeks(frame)[0]
        week = logic.rows_in_week(frame, monday)
        summary = logic.weekly_summary(frame, monday)
        protein = summary.loc[summary["Macro"] == "Protein"].iloc[0]
        self.assertEqual(protein["Days logged"], len(week))
        self.assertAlmostEqual(protein["Average"], float(week["Protein"].mean()))
        self.assertEqual(protein["Min"], float(week["Protein"].min()))
        self.assertEqual(protein["Max"], float(week["Protein"].max()))


if __name__ == "__main__":
    unittest.main()
