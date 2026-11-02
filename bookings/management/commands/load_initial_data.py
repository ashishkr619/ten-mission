from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from bookings.importers import parse_inventory, parse_members, summarize_warnings
from bookings.models import InventoryItem, Member

BATCH_SIZE = 1000  # rows per INSERT


class Command(BaseCommand):
    help = (
        "Load members.csv and inventory.csv into an empty database. "
        "All rows are checked first; if anything is wrong nothing is written."
    )

    def add_arguments(self, parser):
        parser.add_argument("--members", required=True, type=Path, help="Path to members.csv")
        parser.add_argument("--inventory", required=True, type=Path, help="Path to inventory.csv")
        parser.add_argument(
            "--skip-if-loaded",
            action="store_true",
            help="If data is already loaded, do nothing and succeed. "
            "Used when the app starts, so a restart does not try to load again.",
        )

    def handle(self, *args, **options):
        # 1. Read and check both files completely before writing anything.
        try:
            members, member_errors = parse_members(options["members"])
            items, item_errors = parse_inventory(options["inventory"])
        except ValueError as error:  # a whole file is unusable
            raise CommandError(str(error))

        errors = member_errors + item_errors
        if errors:
            raise CommandError(
                f"Found {len(errors)} problem(s). Nothing was imported.\n  " + "\n  ".join(errors)
            )

        # 2. Check nothing is loaded yet (members have no unique key), then write it all in one transaction.
        with transaction.atomic():
            existing_members = Member.objects.count()
            existing_items = InventoryItem.objects.count()
            if existing_members or existing_items:
                already_loaded = (
                    f"Data is already loaded ({existing_members} members, "
                    f"{existing_items} inventory items)."
                )
                if options["skip_if_loaded"]:
                    self.stdout.write(f"{already_loaded} Skipping.")
                    return
                raise CommandError(
                    f"{already_loaded} Nothing was changed.\n"
                    "To start over, wipe the database and start again: "
                    "docker compose down -v && docker compose up --build"
                )
            Member.objects.bulk_create(members, batch_size=BATCH_SIZE)
            InventoryItem.objects.bulk_create(items, batch_size=BATCH_SIZE)

        # 3. Report what was loaded, and anything odd about the data.
        self.stdout.write(self.style.SUCCESS(f"Imported {len(members)} members"))
        self.stdout.write(self.style.SUCCESS(f"Imported {len(items)} inventory items"))

        notes = summarize_warnings(members, items, settings.MAX_BOOKINGS, timezone.localdate())
        if notes:
            self.stdout.write(self.style.WARNING("Notes about the data (all rows were kept):"))
            for note in notes:
                self.stdout.write(self.style.WARNING(f"  - {note}"))
