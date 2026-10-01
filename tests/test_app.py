"""The Streamlit app loads a CSV in memory and does not invent today's zeros."""

from __future__ import annotations

import unittest
from datetime import date
from pathlib import Path

import pandas as pd
from streamlit.testing.v1 import AppTest

import macro_logic as logic

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.py"
REAL = Path("/home/ubuntu/.cursor/projects/workspace/uploads/macro_log_8569.csv")

SMALL = b"""Date,Protein,Carbs,Fat,Calories
2026-09-01,140,,,
2026-09-02,,,,1800
"""

OLD = b"""Date,Protein,Carbs,Fat
2024-01-01,10,20,30
2024-01-02,11,,
"""


def _widget(collection, label):
    for widget in collection:
        if widget.label == label:
            return widget
    raise AssertionError(f"No widget labeled {label!r}. Saw {[item.label for item in collection]}")


class AppSmokeTests(unittest.TestCase):
    def setUp(self):
        self.app = AppTest.from_file(str(APP), default_timeout=90)

    def test_welcome_screen_and_bad_upload(self):
        self.app.run()
        self.assertFalse(self.app.exception)
        self.assertIsNone(self.app.session_state["log_df"])
        self.assertTrue(any("Upload my CSV" == item.label for item in self.app.file_uploader))

        self.app.file_uploader[0].upload("bad.csv", b"Foo,Bar\n1,2\n", "text/csv")
        self.app.run()
        self.assertFalse(self.app.exception)
        self.assertIsNone(self.app.session_state["log_df"])
        self.assertTrue(self.app.error)
        self.assertIn("Protein", self.app.error[0].value)

    def test_start_new_does_not_insert_today_and_blank_fields_stay_blank(self):
        self.app.run()
        _widget(self.app.button, "Start fresh").click()
        self.app.run()
        self.assertFalse(self.app.exception)
        log = self.app.session_state["log_df"]
        self.assertTrue(log.empty)
        self.assertNotIn(pd.Timestamp(date.today()), set(log["Date"]))

        _widget(self.app.number_input, "Protein (g)").set_value(100.0)
        _widget(self.app.button, "Save day").click()
        self.app.run()
        self.assertFalse(self.app.exception)
        saved = self.app.session_state["log_df"]
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved.iloc[0]["Date"].date(), date.today())
        self.assertEqual(saved.iloc[0]["Protein"], 100)
        self.assertTrue(pd.isna(saved.iloc[0]["Carbs"]))
        self.assertTrue(pd.isna(saved.iloc[0]["Fat"]))
        self.assertTrue(pd.isna(saved.iloc[0]["Calories"]))
        exported = logic.to_csv_bytes(saved).decode("utf-8")
        self.assertIn("100", exported)
        self.assertNotIn("nan", exported.lower())
        self.assertTrue(any(item.label == "Download full log (CSV)" for item in self.app.download_button))

    def test_upload_with_blanks_prefills_none_and_edits_survive_a_rerun(self):
        self.app.run()
        self.app.file_uploader[0].upload("macro_log.csv", SMALL, "text/csv")
        self.app.run()
        self.assertFalse(self.app.exception)
        log = self.app.session_state["log_df"]
        self.assertEqual(len(log), 2)
        self.assertTrue(pd.isna(log.loc[log["Date"] == pd.Timestamp("2026-09-01"), "Carbs"]).all())
        self.assertTrue(pd.isna(log.loc[log["Date"] == pd.Timestamp("2026-09-02"), "Protein"]).all())

        self.app.date_input[0].set_value(date(2026, 9, 2))
        self.app.run()
        self.assertFalse(self.app.exception)
        protein = _widget(self.app.number_input, "Protein (g)")
        calories = _widget(self.app.number_input, "Calories")
        self.assertIsNone(protein.value)
        self.assertEqual(calories.value, 1800)

        protein.set_value(125.0)
        _widget(self.app.button, "Save day").click()
        self.app.run()
        edited = self.app.session_state["log_df"]
        row = edited.loc[edited["Date"] == pd.Timestamp("2026-09-02")].iloc[0]
        self.assertEqual(row["Protein"], 125)
        self.assertEqual(row["Calories"], 1800)
        self.assertTrue(pd.isna(row["Carbs"]))
        untouched = edited.loc[edited["Date"] == pd.Timestamp("2026-09-01")].iloc[0]
        self.assertEqual(untouched["Protein"], 140)
        self.assertTrue(pd.isna(untouched["Calories"]))

        # A rerun still has the original upload mounted. It must not reload over the edit.
        self.app.run()
        self.assertFalse(self.app.exception)
        kept = self.app.session_state["log_df"]
        kept_row = kept.loc[kept["Date"] == pd.Timestamp("2026-09-02")].iloc[0]
        self.assertEqual(kept_row["Protein"], 125)
        self.assertEqual(len(kept), 2)

    def test_older_csv_without_calories_shows_a_warning(self):
        self.app.run()
        self.app.file_uploader[0].upload("old.csv", OLD, "text/csv")
        self.app.run()
        self.assertFalse(self.app.exception)
        log = self.app.session_state["log_df"]
        self.assertTrue(log["Calories"].isna().all())
        self.assertTrue(pd.isna(log.loc[1, "Carbs"]))
        self.assertTrue(any("Calories" in item.value for item in self.app.warning))

    def test_blank_calories_are_calculated_when_all_macros_are_present(self):
        self.app.run()
        _widget(self.app.button, "Start fresh").click()
        self.app.run()
        self.assertEqual([tab.label for tab in self.app.tabs], ["Log", "Trends", "Week", "Export"])
        _widget(self.app.number_input, "Protein (g)").set_value(100.0)
        _widget(self.app.number_input, "Carbs (g)").set_value(50.0)
        _widget(self.app.number_input, "Fat (g)").set_value(10.0)
        _widget(self.app.button, "Save day").click()
        self.app.run()
        self.assertFalse(self.app.exception)
        saved = self.app.session_state["log_df"]
        self.assertEqual(saved.iloc[0]["Calories"], 690)

    def test_app_source_does_not_write_a_log_file(self):
        source = APP.read_text()
        self.assertNotIn("open(", source)
        self.assertNotIn("CSV_FILE", source)
        self.assertNotIn("to_csv(", source.replace('.to_csv(index=False).encode("utf-8")', ""))
        self.assertNotIn("<style", source)


@unittest.skipUnless(REAL.is_file(), "attached history is only on the authoring machine")
class RealFileAppTests(unittest.TestCase):
    def test_real_history_renders_and_latest_week_keeps_blanks(self):
        app = AppTest.from_file(str(APP), default_timeout=120)
        app.run()
        app.file_uploader[0].upload("macro_log.csv", REAL.read_bytes(), "text/csv")
        app.run()
        self.assertFalse(app.exception, getattr(app.exception[0], "value", None) if app.exception else None)
        log = app.session_state["log_df"]
        expected, _warnings = logic.load_macro_csv(REAL.read_bytes())
        self.assertEqual(len(log), len(expected))
        latest = log.loc[log["Date"] == log["Date"].max()].iloc[0]
        self.assertTrue(pd.isna(latest["Protein"]))
        pd.testing.assert_frame_equal(log, expected, check_exact=False, atol=0.001)
        latest_week = logic.available_weeks(log)[0]
        summary = app.dataframe[0].value
        formatted = logic.format_summary(logic.weekly_summary(log, latest_week))
        pd.testing.assert_frame_equal(
            summary.reset_index(drop=True).astype(str),
            formatted.reset_index(drop=True).astype(str),
        )
        week = logic.rows_in_week(log, latest_week)
        for column in ("Protein", "Carbs", "Fat"):
            if week[column].notna().any():
                continue
            shown = summary.loc[summary["Macro"] == column].iloc[0]
            self.assertNotEqual(shown["Average"], "0.0")
            self.assertNotEqual(shown["Min"], "0.0")
            self.assertNotIn("0.0", str(shown["Average"]))
        self.assertEqual([tab.label for tab in app.tabs], ["Log", "Trends", "Week", "Export"])
        self.assertTrue(any(item.label == "Download full log (CSV)" for item in app.download_button))
        self.assertTrue(any(item.label == "Download weekly summary PDF" for item in app.download_button))


if __name__ == "__main__":
    unittest.main()
