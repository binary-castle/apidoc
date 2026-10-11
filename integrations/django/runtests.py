#!/usr/bin/env python
"""Run the test suite with Django's own runner: python runtests.py"""

import os
import sys

import django
from django.conf import settings
from django.test.utils import get_runner

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:0] = [here, os.path.join(here, "src")]
    os.environ["DJANGO_SETTINGS_MODULE"] = "tests.settings"
    django.setup()
    failures = get_runner(settings)().run_tests(["tests"])
    sys.exit(bool(failures))
