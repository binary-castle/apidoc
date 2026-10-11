#!/usr/bin/env python
"""Run the test suite with the standard library runner: python runtests.py"""

import os
import sys
import unittest

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:0] = [here, os.path.join(here, "src")]
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.discover(os.path.join(here, "tests"), top_level_dir=here))
    sys.exit(not result.wasSuccessful())
