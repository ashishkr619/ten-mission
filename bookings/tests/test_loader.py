"""Tests for reading the CSV files (importers.py) and the load_initial_data command."""
import tempfile
from datetime import date, datetime
from datetime import timezone as dt_timezone
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from bookings.importers import parse_inventory, parse_members, summarize_warnings
from bookings.models import InventoryItem, Member

MEMBER_HEADER = "name,surname,booking_count,date_joined\n"
INVENTORY_HEADER = "title,description,remaining_count,expiration_date\n"


class TempFilesMixin:
    """Gives each test a temporary folder and a helper to write CSV files into it."""

    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)

    def write(self, name, text, bom=True):
        """Write a file. Like the real files, it starts with a hidden BOM by default."""
        path = self.folder / name
        path.write_text(("\ufeff" if bom else "") + text, encoding="utf-8")
        return path


class ParserTests(TempFilesMixin, SimpleTestCase):
    def test_bom_whitespace_and_multiline_description(self):
        """The hidden BOM, extra spaces and multi-line descriptions are read correctly."""
        members = self.write("m.csv", MEMBER_HEADER + " James  ,Brown,0,2024-01-02T12:10:25\n")
        description = '"Line one, with comma\nline two ""quoted"""'  # quoted CSV field
        items = self.write(
            "i.csv", INVENTORY_HEADER + f"  Rome  ,{description},5,27/11/2030\n"
        )

        parsed_members, errors = parse_members(members)
        self.assertEqual(errors, [])
        self.assertEqual(
            (parsed_members[0].first_name, parsed_members[0].last_name), ("James", "Brown")
        )

        parsed_items, errors = parse_inventory(items)
        self.assertEqual(errors, [])
        self.assertEqual(parsed_items[0].title, "Rome")
        self.assertIn("with comma\nline two", parsed_items[0].description)

    def test_naive_timestamp_is_read_as_utc(self):
        """A join date without a time zone is read as UTC."""
        path = self.write("m.csv", MEMBER_HEADER + "A,B,1,2024-01-02T12:10:11\n")
        members, _ = parse_members(path)
        self.assertEqual(
            members[0].date_joined, datetime(2024, 1, 2, 12, 10, 11, tzinfo=dt_timezone.utc)
        )

    def test_bad_values_give_row_numbers_and_all_problems(self):
        """Every bad row is reported with its row number; good rows are still read."""
        path = self.write(
            "m.csv",
            MEMBER_HEADER
            + "Ok,Person,1,2024-01-02T12:10:11\n"    # row 2: fine
            + "Bad,Count,abc,2024-01-02T12:10:11\n"  # row 3
            + "Neg,Count,-1,2024-01-02T12:10:11\n"   # row 4
            + "Bad,Date,1,not-a-date\n"              # row 5
            + " ,Nameless,1,2024-01-02T12:10:11\n",  # row 6
        )

        members, errors = parse_members(path)

        self.assertEqual(len(members), 1)
        joined = "\n".join(errors)
        for row in (3, 4, 5, 6):
            self.assertIn(f"row {row}", joined)
        self.assertNotIn("row 2", joined)

    def test_expiration_date_must_be_strict_dd_mm_yyyy(self):
        """Only dates written exactly as DD/MM/YYYY are accepted."""
        values = ["19/11/2030", "2030-11-19", "1/2/2030", "31/02/2030"]
        rows = "".join(f"T{number},d,1,{value}\n" for number, value in enumerate(values))

        items, errors = parse_inventory(self.write("i.csv", INVENTORY_HEADER + rows))

        self.assertEqual(len(items), 1)  # only the first is valid
        self.assertEqual(len(errors), 3)

    def test_only_plain_digits_are_accepted(self):
        """Counts must use the digits 0-9 only."""
        # "\u0663" is the Arabic-Indic digit three. Python's int() would accept it.
        path = self.write("m.csv", MEMBER_HEADER + "A,B,\u0663,2024-01-02T12:10:11\n")
        members, errors = parse_members(path)
        self.assertEqual(members, [])
        self.assertTrue(errors)

    def test_unusable_file_raises(self):
        """A missing column or a missing file stops the whole import."""
        missing_column = self.write("m.csv", "name,surname\nA,B\n")
        with self.assertRaises(ValueError) as context:
            parse_members(missing_column)
        self.assertIn("missing column", str(context.exception))

        with self.assertRaises(ValueError) as context:
            parse_members(self.folder / "does-not-exist.csv")
        self.assertIn("cannot read file", str(context.exception))

    def test_short_row_is_an_error_not_a_crash(self):
        """A row with too few cells is reported, not a crash."""
        path = self.write("m.csv", MEMBER_HEADER + "Only,Two\n")
        members, errors = parse_members(path)
        self.assertEqual(members, [])
        self.assertTrue(errors)

    def test_warning_summary(self):
        """Odd but allowed data is summarised in notes."""
        members, _ = parse_members(
            self.write(
                "m.csv",
                MEMBER_HEADER
                + "Sophie,Davis,1,2024-01-02T12:10:11\n"
                + "Sophie,Davis,3,2022-01-02T12:10:11\n",
            )
        )
        items, _ = parse_inventory(
            self.write(
                "i.csv",
                INVENTORY_HEADER + "London,d,0,30/11/2030\n" + "London,d,1,01/12/2023\n",
            )
        )

        notes = "\n".join(summarize_warnings(members, items, 2, date(2026, 10, 31)))

        self.assertIn("Sophie Davis", notes)
        self.assertIn("London", notes)
        self.assertIn("1 member(s) already have more than 2", notes)
        self.assertIn("1 inventory item(s) are expired", notes)
        self.assertIn("1 inventory item(s) have no remaining stock", notes)


class LoaderCommandTests(TempFilesMixin, TestCase):
    def run_loader(self, members, inventory):
        out = StringIO()
        call_command("load_initial_data", members=members, inventory=inventory, stdout=out)
        return out.getvalue()

    def test_real_files_load_completely_and_keep_every_row(self):
        """The real CSV files load completely, keeping every row."""
        output = self.run_loader(
            settings.DATA_DIR / "members.csv", settings.DATA_DIR / "inventory.csv"
        )

        self.assertEqual(Member.objects.count(), 45)
        self.assertEqual(InventoryItem.objects.count(), 15)
        self.assertIn("Imported 45 members", output)
        self.assertIn("Imported 15 inventory items", output)

        # Duplicates are separate rows, each with its own id.
        self.assertEqual(Member.objects.filter(first_name="Sophie", last_name="Davis").count(), 2)
        self.assertEqual(Member.objects.filter(first_name="Grace", last_name="Miller").count(), 2)
        self.assertEqual(InventoryItem.objects.filter(title="London").count(), 2)

        # Whitespace is cleaned; odd-but-valid rows are kept.
        self.assertTrue(Member.objects.filter(first_name="James", last_name="Brown").exists())
        self.assertEqual(Member.objects.filter(active_booking_count__gt=2).count(), 3)
        self.assertEqual(InventoryItem.objects.filter(expiration_date__lt=timezone.localdate()).count(), 3)
        self.assertEqual(InventoryItem.objects.filter(remaining_count=0).count(), 1)

        # The CSV count becomes the starting counter.
        jessica = Member.objects.get(first_name="Jessica", last_name="Rodriguez")
        self.assertEqual(jessica.active_booking_count, 3)
        self.assertIn("Notes about the data", output)

    def test_one_bad_row_writes_nothing_from_either_file(self):
        """One bad row anywhere means nothing is written from either file."""
        members = self.write("m.csv", MEMBER_HEADER + "A,B,1,2024-01-02T12:10:11\n")
        items = self.write(
            "i.csv", INVENTORY_HEADER + "Good,d,1,01/01/2030\n" + "Bad,d,1,2030-01-01\n"
        )

        with self.assertRaises(CommandError) as context:
            self.run_loader(members, items)

        self.assertIn("i.csv row 3", str(context.exception))
        self.assertEqual(Member.objects.count(), 0)  # the good members file wrote nothing too
        self.assertEqual(InventoryItem.objects.count(), 0)

    def test_unreadable_file_is_a_clear_error(self):
        """A missing file gives a clear error."""
        members = self.write("m.csv", MEMBER_HEADER + "A,B,1,2024-01-02T12:10:11\n")
        with self.assertRaises(CommandError) as context:
            self.run_loader(members, self.folder / "missing.csv")
        self.assertIn("cannot read file", str(context.exception))

    def test_second_run_is_refused_and_changes_nothing(self):
        """Loading twice is refused and changes nothing."""
        members = self.write("m.csv", MEMBER_HEADER + "A,B,1,2024-01-02T12:10:11\n")
        items = self.write("i.csv", INVENTORY_HEADER + "Good,d,1,01/01/2030\n")
        self.run_loader(members, items)

        with self.assertRaises(CommandError) as context:
            self.run_loader(members, items)

        self.assertIn("already loaded", str(context.exception))
        self.assertIn("docker compose down -v", str(context.exception))
        self.assertEqual(Member.objects.count(), 1)
        self.assertEqual(InventoryItem.objects.count(), 1)

    def test_skip_if_loaded_makes_a_restart_a_calm_no_op(self):
        """With --skip-if-loaded a second run does nothing and succeeds."""
        members = self.write("m.csv", MEMBER_HEADER + "A,B,1,2024-01-02T12:10:11\n")
        items = self.write("i.csv", INVENTORY_HEADER + "Good,d,1,01/01/2030\n")
        self.run_loader(members, items)

        out = StringIO()
        call_command(
            "load_initial_data", members=members, inventory=items, skip_if_loaded=True, stdout=out
        )  # does not raise an error

        self.assertIn("Skipping", out.getvalue())
        self.assertEqual(Member.objects.count(), 1)  # nothing was added
        self.assertEqual(InventoryItem.objects.count(), 1)
